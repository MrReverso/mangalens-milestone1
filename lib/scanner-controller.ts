import { isMangaImageCandidate } from "@/lib/image-detector";
import type {
  ExtensionMessage,
  ScanPageResponse,
  ScanStatusResponse,
  TranslationCommandResponse,
  TranslationStatusResponse,
} from "@/lib/messages";
import { isImageVisible } from "@/lib/image-position";
import { MockTranslationProvider } from "@/lib/mock-translation-provider";
import { OverlayManager } from "@/lib/overlay-manager";
import { TranslationOverlayManager } from "@/lib/translation-overlay-manager";
import { TranslationQueue } from "@/lib/translation-queue";
import type {
  PageTranslation,
  TranslatePageResult,
  TranslationProvider,
} from "@/types/translation";
import type { SourceLanguage, TargetLanguage } from "@/types/extension";

type ScannerResponse =
  | ScanPageResponse
  | ScanStatusResponse
  | TranslationCommandResponse
  | TranslationStatusResponse;
type SendResponse = (response: ScannerResponse) => void;

interface PageSession extends PageTranslation {
  readonly element: HTMLImageElement;
}

export class MangaScannerController {
  private readonly overlay = new OverlayManager();
  private readonly translationOverlay: TranslationOverlayManager;
  private readonly translationQueue = new TranslationQueue<TranslatePageResult>();
  private readonly translationProvider: TranslationProvider;
  private registeredElements = new WeakSet<HTMLImageElement>();
  private pageByElement = new WeakMap<HTMLImageElement, PageSession>();
  private readonly pages = new Map<string, PageSession>();
  private readonly pendingLoadListeners = new Map<
    HTMLImageElement,
    EventListener
  >();
  private currentPageNumber = 0;
  private isScanning = false;
  private domObserver: MutationObserver | null = null;
  private translationsVisible = true;
  private nextPageId = 1;

  constructor(
    translationProvider: TranslationProvider = new MockTranslationProvider(),
    translationOverlay = new TranslationOverlayManager()
  ) {
    this.translationProvider = translationProvider;
    this.translationOverlay = translationOverlay;
  }

  readonly messageHandler = (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: SendResponse
  ): boolean => {
    switch (message.type) {
      case "SCAN_PAGE":
        this.scanPage(sendResponse);
        return true;
      case "CLEAR_MARKERS":
        this.clearMarkers(sendResponse);
        return false;
      case "GET_SCAN_STATUS":
        this.getScanStatus(sendResponse);
        return false;
      case "START_MOCK_TRANSLATION":
        this.startMockTranslation(
          message.sourceLanguage,
          message.targetLanguage,
          sendResponse
        );
        return false;
      case "SET_TRANSLATIONS_VISIBLE":
        this.setTranslationsVisible(message.visible, sendResponse);
        return false;
      case "CLEAR_TRANSLATIONS":
        this.clearTranslations(sendResponse);
        return false;
      case "GET_TRANSLATION_STATUS":
        sendResponse(this.translationStatus());
        return false;
      default:
        sendResponse({ success: false, error: "Unknown command" });
        return false;
    }
  };

  initialize(): void {
    chrome.runtime.onMessage.addListener(this.messageHandler);
  }

  destroy(): void {
    chrome.runtime.onMessage.removeListener(this.messageHandler);
    this.stopLazyObserver();
    this.removePendingLoadListeners();
    this.resetTranslations();
    this.pages.clear();
    this.overlay.clearAll();
  }

  processImageCandidate(img: HTMLImageElement): void {
    if (img.closest("[data-mangalens-root]")) return;
    if (this.registeredElements.has(img)) return;

    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
      this.waitForImageLoad(img);
      return;
    }

    this.removePendingLoadListener(img);
    if (!document.contains(img)) return;
    if (!isMangaImageCandidate(img, this.registeredElements)) return;

    this.registeredElements.add(img);
    this.currentPageNumber++;
    const session: PageSession = {
      pageId: `mangalens-page-${this.nextPageId++}`,
      pageNumber: this.currentPageNumber,
      element: img,
      status: "detected",
      bubbles: [],
    };
    this.pageByElement.set(img, session);
    this.pages.set(session.pageId, session);
    this.overlay.addMarker({
      element: img,
      pageNumber: this.currentPageNumber,
    });
    this.overlay.observeImage(img);
  }

  private scanPage(sendResponse: SendResponse): void {
    if (this.isScanning) {
      sendResponse({
        success: true,
        detectedImages: this.overlay.count,
      });
      return;
    }

    this.isScanning = true;
    try {
      for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
        this.processImageCandidate(img);
      }
      this.overlay.startListening();
      this.startLazyObserver();
      sendResponse({
        success: true,
        detectedImages: this.overlay.count,
      });
    } catch (error: unknown) {
      sendResponse({
        success: false,
        error: error instanceof Error
          ? error.message
          : "An unexpected error occurred",
      });
    } finally {
      this.isScanning = false;
    }
  }

  private clearMarkers(sendResponse: SendResponse): void {
    try {
      this.stopLazyObserver();
      this.removePendingLoadListeners();
      this.resetTranslations();
      this.overlay.clearAll();
      this.registeredElements = new WeakSet<HTMLImageElement>();
      this.pageByElement = new WeakMap<HTMLImageElement, PageSession>();
      this.pages.clear();
      this.currentPageNumber = 0;
      this.nextPageId = 1;
      sendResponse({ success: true, detectedImages: 0 });
    } catch (error: unknown) {
      sendResponse({
        success: false,
        error: error instanceof Error
          ? error.message
          : "An unexpected error occurred",
      });
    }
  }

  private getScanStatus(sendResponse: SendResponse): void {
    sendResponse({
      type: "SCAN_STATUS",
      detectedImages: this.overlay.count,
      isScanning: this.isScanning,
    });
  }

  private waitForImageLoad(img: HTMLImageElement): void {
    if (this.pendingLoadListeners.has(img)) return;

    const listener: EventListener = () => {
      this.pendingLoadListeners.delete(img);
      this.processImageCandidate(img);
    };
    this.pendingLoadListeners.set(img, listener);
    img.addEventListener("load", listener, { once: true });
  }

  private removePendingLoadListener(img: HTMLImageElement): void {
    const listener = this.pendingLoadListeners.get(img);
    if (!listener) return;
    img.removeEventListener("load", listener);
    this.pendingLoadListeners.delete(img);
  }

  private removePendingLoadListeners(): void {
    for (const [img, listener] of this.pendingLoadListeners) {
      img.removeEventListener("load", listener);
    }
    this.pendingLoadListeners.clear();
  }

  private startLazyObserver(): void {
    if (this.domObserver) return;

    this.domObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          this.processImageCandidate(mutation.target as HTMLImageElement);
          continue;
        }

        for (const node of mutation.removedNodes) {
          this.processRemovedNode(node);
        }
        for (const node of mutation.addedNodes) {
          this.processAddedNode(node);
        }
      }
    });

    this.domObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src", "srcset"],
      childList: true,
      subtree: true,
    });
  }

  private stopLazyObserver(): void {
    this.domObserver?.disconnect();
    this.domObserver = null;
  }

  private processAddedNode(node: Node): void {
    if (!(node instanceof HTMLElement)) return;
    if (node instanceof HTMLImageElement) {
      this.processImageCandidate(node);
    }
    for (const img of node.querySelectorAll<HTMLImageElement>("img")) {
      this.processImageCandidate(img);
    }
  }

  private processRemovedNode(node: Node): void {
    if (!(node instanceof HTMLElement)) return;
    if (node instanceof HTMLImageElement) {
      this.removeImage(node);
    }
    for (const img of node.querySelectorAll<HTMLImageElement>("img")) {
      this.removeImage(img);
    }
  }

  private removeImage(img: HTMLImageElement): void {
    this.removePendingLoadListener(img);
    this.overlay.removeMarker(img);
    const page = this.pageByElement.get(img);
    if (page) {
      this.translationQueue.cancel(page.pageId);
      this.translationOverlay.removePage(page.pageId);
      this.pages.delete(page.pageId);
      this.pageByElement.delete(img);
    }
    this.registeredElements.delete(img);
  }

  private startMockTranslation(
    sourceLanguage: SourceLanguage,
    targetLanguage: TargetLanguage,
    sendResponse: SendResponse
  ): void {
    const candidates = [...this.pages.values()]
      .filter((page) => page.status === "detected" || page.status === "error")
      .sort((a, b) => {
        const visibleDifference =
          Number(isImageVisible(b.element)) - Number(isImageVisible(a.element));
        return visibleDifference || a.pageNumber - b.pageNumber;
      });

    for (const page of candidates) {
      page.status = "queued";
      page.error = undefined;
      this.translationQueue.enqueue({
        pageId: page.pageId,
        onStart: () => {
          page.status = "translating";
        },
        run: (signal) => this.translationProvider.translatePage({
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          sourceLanguage,
          targetLanguage,
        }, signal),
        onComplete: (result) => {
          if (!this.pages.has(page.pageId)) return;
          page.status = "complete";
          page.bubbles = result.bubbles;
          this.translationOverlay.renderPage(
            page.pageId,
            page.element,
            page.bubbles
          );
        },
        onError: (error) => {
          page.status = "error";
          page.error = error.message;
        },
      });
    }
    sendResponse({ success: true, status: this.translationStatus() });
  }

  private setTranslationsVisible(
    visible: boolean,
    sendResponse: SendResponse
  ): void {
    this.translationsVisible = visible;
    this.translationOverlay.setVisible(visible);
    sendResponse({ success: true, status: this.translationStatus() });
  }

  private clearTranslations(sendResponse: SendResponse): void {
    this.resetTranslations();
    sendResponse({ success: true, status: this.translationStatus() });
  }

  private resetTranslations(): void {
    this.translationQueue.clear();
    this.translationOverlay.clear();
    for (const page of this.pages.values()) {
      page.status = "detected";
      page.bubbles = [];
      page.error = undefined;
    }
  }

  private translationStatus(): TranslationStatusResponse {
    const pages = [...this.pages.values()];
    return {
      type: "TRANSLATION_STATUS",
      totalPages: pages.length,
      queuedPages: pages.filter((page) => page.status === "queued").length,
      translatingPages: pages.filter((page) => page.status === "translating").length,
      completedPages: pages.filter((page) => page.status === "complete").length,
      failedPages: pages.filter((page) => page.status === "error").length,
      translationsVisible: this.translationsVisible,
    };
  }
}
