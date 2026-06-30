/**
 * Unit tests for isMangaImageCandidate — the pure detection logic.
 *
 * We mock only the minimum DOM APIs needed (getBoundingClientRect,
 * getComputedStyle) to keep tests readable and fast.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isMangaImageCandidate } from "@/lib/image-detector";

// ── Mock helpers ───────────────────────────────────────────────

function createMockImage(overrides: {
  rect?: DOMRect;
  naturalWidth?: number;
  naturalHeight?: number;
  className?: string;
  alt?: string;
  style?: Partial<CSSStyleDeclaration>;
  computedStyle?: Partial<CSSStyleDeclaration>;
  parentComputedStyle?: Partial<CSSStyleDeclaration> | null;
  width?: number;
  height?: number;
  closest?: (selector: string) => Element | null;
  getAttribute?: (name: string) => string | null;
}): HTMLImageElement {
  const rect = overrides.rect ?? new DOMRect(0, 0, 800, 1200);
  const computed = overrides.computedStyle ?? {
    display: "",
    visibility: "",
    opacity: "1",
  };

  const img = {
    getBoundingClientRect: () => rect,
    naturalWidth: overrides.naturalWidth ?? 800,
    naturalHeight: overrides.naturalHeight ?? 1200,
    className: overrides.className ?? "",
    alt: overrides.alt ?? "",
    width: overrides.width ?? 800,
    height: overrides.height ?? 1200,
    closest: overrides.closest ?? (() => null),
    getAttribute: overrides.getAttribute ?? (() => null),
    parentElement: null as Element | null,
  } as unknown as HTMLImageElement;

  // Mock getComputedStyle
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
    if (el === img) return computed as CSSStyleDeclaration;
    // Parent element
    if (el === img.parentElement && overrides.parentComputedStyle) {
      return overrides.parentComputedStyle as CSSStyleDeclaration;
    }
    return {
      display: "",
      visibility: "",
      opacity: "1",
    } as CSSStyleDeclaration;
  });

  return img;
}

// ── Tests ──────────────────────────────────────────────────────

describe("isMangaImageCandidate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a large visible vertical manga image", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 800, 1200),
      naturalWidth: 800,
      naturalHeight: 1200,
    });

    expect(isMangaImageCandidate(img)).toBe(true);
  });

  it("rejects a small logo", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 100, 40),
      naturalWidth: 200,
      naturalHeight: 80,
      className: "site-logo",
      alt: "Site logo",
    });

    expect(isMangaImageCandidate(img)).toBe(false);
  });

  it("rejects a hidden image (display: none)", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 800, 1200),
      naturalWidth: 800,
      naturalHeight: 1200,
      computedStyle: {
        display: "none",
        visibility: "",
        opacity: "1",
      },
    });

    expect(isMangaImageCandidate(img)).toBe(false);
  });

  it("rejects an image with insufficient natural dimensions", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 800, 1200),
      naturalWidth: 200,  // Below 300 threshold
      naturalHeight: 300,
    });

    expect(isMangaImageCandidate(img)).toBe(false);
  });

  it("accepts a large wide comic page", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 1200, 600),
      naturalWidth: 1200,
      naturalHeight: 600,
    });

    // 1200 * 600 = 720,000 which is > 100,000
    // Both rendered dimensions >= 280
    // Both natural dimensions >= 300
    expect(isMangaImageCandidate(img)).toBe(true);
  });

  it("rejects an image already registered via WeakSet", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 800, 1200),
      naturalWidth: 800,
      naturalHeight: 1200,
    });

    const registered = new WeakSet<HTMLImageElement>();
    registered.add(img);

    expect(isMangaImageCandidate(img, registered)).toBe(false);
  });

  it("rejects an image with visibility: hidden", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 800, 1200),
      naturalWidth: 800,
      naturalHeight: 1200,
      computedStyle: {
        display: "",
        visibility: "hidden",
        opacity: "1",
      },
    });

    expect(isMangaImageCandidate(img)).toBe(false);
  });

  it("rejects an image with near-zero opacity", () => {
    const img = createMockImage({
      rect: new DOMRect(0, 0, 800, 1200),
      naturalWidth: 800,
      naturalHeight: 1200,
      computedStyle: {
        display: "",
        visibility: "",
        opacity: "0.05",
      },
    });

    expect(isMangaImageCandidate(img)).toBe(false);
  });

  it("rejects an image whose rendered area is below 100,000 px²", () => {
    // 281 * 281 = 78,961 — below threshold
    const img = createMockImage({
      rect: new DOMRect(0, 0, 281, 281),
      naturalWidth: 400,
      naturalHeight: 400,
    });

    expect(isMangaImageCandidate(img)).toBe(false);
  });
});