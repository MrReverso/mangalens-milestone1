// ── Content Script ─────────────────────────────────────────────
// Injected programmatically by the popup via chrome.scripting.executeScript.
// Sets up a message listener and waits for commands.

import { scanPageForMangaImages, isMangaImageCandidate } from "@/lib/image-detector";
import { OverlayManager } from "@/lib/overlay-manager";
import type {
  ExtensionMessage,
  ScanPageResponse,
  ScanStatusResponse,
} from "@/lib/messages";
import type { DetectedImage } from "@/types/extension";

// ── State (module-scoped, not global) ───────────────────────────

const overlay = new OverlayManager();
const registeredElements = new WeakSet<HTMLImageElement>();
let currentPageNumber = 0;
let isScanning = false;
let domObserver: MutationObserver | null = null;
let lazyObserverActive = false;

// ── Message Handler ────────────────────────────────────────────

const messageHandler = (
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: ScanPageResponse | ScanStatusResponse) => void
): boolean => {
  switch (message.type) {
    case "SCAN_PAGE":
      handleScanPage(sendResponse);
      return true;

    case "CLEAR_MARKERS":
      handleClearMarkers(sendResponse);
      return false;

    case "GET_SCAN_STATUS":
      handleGetScanStatus(sendResponse);
      return false;

    default:
      sendResponse({ success: false, error: "Unknown command" });
      return false;
  }
};

// Remove any previous listener to prevent duplicates on re-injection,
// then register the handler.
chrome.runtime.onMessage.removeListener(messageHandler);
chrome.runtime.onMessage.addListener(messageHandler);

// ── Cleanup on page unload ─────────────────────────────────────

window.addEventListener("unload", () => {
  stopLazyObserver();
  overlay.clearAll();
});

// ── Handlers ───────────────────────────────────────────────────

function handleScanPage(sendResponse: (response: ScanPageResponse) => void): void {
  isScanning = true;

  try {
    const candidates = scanPageForMangaImages(registeredElements);

    for (const img of candidates) {
      registeredElements.add(img);
      currentPageNumber++;

      const entry: DetectedImage = {
        element: img,
        pageNumber: currentPageNumber,
      };
      overlay.addMarker(entry);
      overlay.observeImage(img);
    }

    overlay.startListening();
    startLazyObserver();

    isScanning = false;
    sendResponse({ success: true, detectedImages: currentPageNumber });
  } catch (err: unknown) {
    isScanning = false;
    const errorMessage =
      err instanceof Error ? err.message : "An unexpected error occurred";
    sendResponse({ success: false, error: errorMessage });
  }
}

function handleClearMarkers(sendResponse: (response: ScanPageResponse) => void): void {
  try {
    stopLazyObserver();
    overlay.clearAll();
    currentPageNumber = 0;
    sendResponse({ success: true, detectedImages: 0 });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "An unexpected error occurred";
    sendResponse({ success: false, error: errorMessage });
  }
}

function handleGetScanStatus(sendResponse: (response: ScanStatusResponse) => void): void {
  sendResponse({
    type: "SCAN_STATUS",
    detectedImages: overlay.count,
    isScanning,
  });
}

// ── Lazy-Load Observer ─────────────────────────────────────────

function startLazyObserver(): void {
  if (lazyObserverActive) return;
  lazyObserverActive = true;

  domObserver = new MutationObserver((mutations) => {
    if (!lazyObserverActive) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        const imgs = node.tagName === "IMG"
          ? [node as HTMLImageElement]
          : Array.from(node.querySelectorAll<HTMLImageElement>("img"));

        for (const img of imgs) {
          if (img.closest("[data-mangalens-root]")) continue;
          if (registeredElements.has(img)) continue;

          requestAnimationFrame(() => {
            if (registeredElements.has(img)) return;
            if (isMangaImageCandidate(img, registeredElements)) {
              registeredElements.add(img);
              currentPageNumber++;
              overlay.addMarker({ element: img, pageNumber: currentPageNumber });
              overlay.observeImage(img);
            }
          });
        }
      }
    }
  });

  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function stopLazyObserver(): void {
  lazyObserverActive = false;
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
}

export default defineUnlistedScript(() => {
  // Script logic runs at module scope above.
  // This callback is required by WXT's defineUnlistedScript.
});