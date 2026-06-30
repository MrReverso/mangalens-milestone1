import { isMangaImageCandidate } from "@/lib/image-detector";
import type {
  ExtensionMessage,
  ScanPageResponse,
  ScanStatusResponse,
} from "@/lib/messages";
import { OverlayManager } from "@/lib/overlay-manager";

type ScannerResponse = ScanPageResponse | ScanStatusResponse;
type SendResponse = (response: ScannerResponse) => void;

export class MangaScannerController {
  private readonly overlay = new OverlayManager();
  private registeredElements = new WeakSet<HTMLImageElement>();
  private readonly pendingLoadListeners = new Map<
    HTMLImageElement,
    EventListener
  >();
  private currentPageNumber = 0;
  private isScanning = false;
  private domObserver: MutationObserver | null = null;

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
    }
  };

  initialize(): void {
    chrome.runtime.onMessage.addListener(this.messageHandler);
  }

  destroy(): void {
    chrome.runtime.onMessage.removeListener(this.messageHandler);
    this.stopLazyObserver();
    this.removePendingLoadListeners();
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
      this.overlay.clearAll();
      this.registeredElements = new WeakSet<HTMLImageElement>();
      this.currentPageNumber = 0;
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
    this.registeredElements.delete(img);
  }
}
