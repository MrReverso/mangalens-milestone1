// ── Overlay Manager ────────────────────────────────────────────
// Responsible for creating, positioning, and removing visual
// page markers without modifying the original website images.

import type { DetectedImage } from "@/types/extension";

const OVERLAY_ROOT_ID = "mangalens-overlay-root";
const MARKER_CLASS = "mangalens-marker";
const BADGE_CLASS = "mangalens-badge";

const ACCENT_COLOR = "#00d4aa";
const BADGE_BG = "rgba(0, 30, 50, 0.88)";
const BADGE_TEXT = "#ffffff";
const OUTLINE_WIDTH = 2;

/** Throttle delay (ms) for scroll and resize handlers. */
const THROTTLE_MS = 50;

export class OverlayManager {
  private root: HTMLElement | null = null;
  private markers: Map<HTMLImageElement, HTMLElement> = new Map();
  private scrollHandler: (() => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private throttledUpdate: (() => void) | null = null;
  private captureSuppressed = false;

  /**
   * Create the overlay root element if it doesn't exist yet.
   */
  ensureRoot(): HTMLElement {
    if (this.root) return this.root;

    let existing = document.getElementById(OVERLAY_ROOT_ID);
    if (existing) {
      this.root = existing;
      return this.root;
    }

    const el = document.createElement("div");
    el.id = OVERLAY_ROOT_ID;
    el.setAttribute("data-mangalens-root", "true");
    Object.assign(el.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "2147483640",
      overflow: "hidden",
      visibility: this.captureSuppressed ? "hidden" : "visible",
    } as CSSStyleDeclaration);
    document.documentElement.appendChild(el);
    this.root = el;
    return el;
  }

  /**
   * Add a numbered page marker for a detected image.
   */
  addMarker(detected: DetectedImage): void {
    if (this.markers.has(detected.element)) return;

    const root = this.ensureRoot();

    const marker = document.createElement("div");
    marker.className = MARKER_CLASS;
    Object.assign(marker.style, {
      position: "absolute",
      boxSizing: "border-box",
      border: `${OUTLINE_WIDTH}px solid ${ACCENT_COLOR}`,
      borderRadius: "3px",
      pointerEvents: "none",
    } as CSSStyleDeclaration);

    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.textContent = `Page ${detected.pageNumber}`;
    Object.assign(badge.style, {
      position: "absolute",
      top: "-24px",
      left: "0",
      background: BADGE_BG,
      color: BADGE_TEXT,
      fontSize: "11px",
      fontWeight: "600",
      fontFamily: "system-ui, -apple-system, sans-serif",
      lineHeight: "1",
      padding: "4px 8px",
      borderRadius: "3px 3px 3px 0",
      whiteSpace: "nowrap",
      letterSpacing: "0.02em",
    } as CSSStyleDeclaration);

    marker.appendChild(badge);
    root.appendChild(marker);
    this.markers.set(detected.element, marker);

    this.positionMarker(detected.element, marker);
  }

  /**
   * Position a single marker over its target image.
   */
  private positionMarker(img: HTMLImageElement, marker: HTMLElement): void {
    const rect = img.getBoundingClientRect();

    Object.assign(marker.style, {
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    } as CSSStyleDeclaration);
  }

  /**
   * Update all marker positions (e.g. after scroll or resize).
   */
  updateAllPositions(): void {
    for (const [img, marker] of this.markers) {
      if (!document.contains(img)) {
        this.removeMarker(img);
        continue;
      }
      this.positionMarker(img, marker);
    }
  }

  /**
   * Start listening to scroll and resize events.
   */
  startListening(): void {
    if (this.scrollHandler) return; // Already listening.

    this.throttledUpdate = throttle(() => this.updateAllPositions(), THROTTLE_MS);

    this.scrollHandler = this.throttledUpdate;
    window.addEventListener("scroll", this.scrollHandler, {
      capture: true,
      passive: true,
    });

    this.resizeHandler = this.throttledUpdate;
    window.addEventListener("resize", this.resizeHandler, { passive: true });

    // ResizeObserver for individual image size changes.
    this.resizeObserver = new ResizeObserver(() => this.updateAllPositions());
    for (const img of this.markers.keys()) {
      if (document.contains(img)) {
        this.resizeObserver.observe(img);
      }
    }
  }

  /**
   * Stop listening to scroll and resize events.
   */
  stopListening(): void {
    if (this.scrollHandler) {
      window.removeEventListener("scroll", this.scrollHandler, true);
      this.scrollHandler = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.throttledUpdate = null;
  }

  /**
   * Remove all markers and the overlay root.
   */
  clearAll(): void {
    this.stopListening();

    for (const [, marker] of this.markers) {
      marker.remove();
    }
    this.markers.clear();

    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.captureSuppressed = false;
  }

  /**
   * Get the current number of active markers.
   */
  get count(): number {
    return this.markers.size;
  }

  /**
   * Observe an image element for future size changes.
   * Call after adding new markers to keep positions accurate.
   */
  observeImage(img: HTMLImageElement): void {
    if (this.resizeObserver && document.contains(img)) {
      this.resizeObserver.observe(img);
    }
  }

  /**
   * Remove one image's marker and stop tracking its size.
   */
  removeMarker(img: HTMLImageElement): void {
    const marker = this.markers.get(img);
    if (!marker) return;

    this.resizeObserver?.unobserve(img);
    marker.remove();
    this.markers.delete(img);
  }

  setCaptureSuppressed(suppressed: boolean): void {
    this.captureSuppressed = suppressed;
    if (this.root) {
      this.root.style.visibility = suppressed ? "hidden" : "visible";
    }
  }
}

// ── Utility ────────────────────────────────────────────────────

function throttle(fn: () => void, ms: number): () => void {
  let lastCall = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  return () => {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed >= ms) {
      lastCall = now;
      fn();
    } else if (!timerId) {
      timerId = setTimeout(() => {
        lastCall = Date.now();
        timerId = null;
        fn();
      }, ms - elapsed);
    }
  };
}
