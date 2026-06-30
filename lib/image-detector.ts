// ── Manga Image Detection ──────────────────────────────────────
// Centralised detection rules so thresholds can be adjusted in one place.

const MIN_RENDERED_WIDTH = 280;
const MIN_RENDERED_HEIGHT = 280;
const MIN_NATURAL_WIDTH = 300;
const MIN_NATURAL_HEIGHT = 300;
const MIN_RENDERED_AREA = 100_000; // 100,000 square pixels

// Set of known CSS class / role patterns for non-content images.
// These are checked via simple substring match on className.
const NON_CONTENT_PATTERNS = [
  "logo",
  "avatar",
  "icon",
  "emoji",
  "favicon",
  "badge",
  "spinner",
  "loading",
  "breadcrumb",
  "social",
  "share",
  "cookie",
  "banner-ad",
  "advertisement",
  "sidebar-icon",
];

/**
 * Check whether an image element looks like a manga / webtoon page.
 *
 * All conditions must be satisfied:
 *  - Visible (not hidden via display, visibility, or opacity)
 *  - Rendered width  ≥ 280 px
 *  - Rendered height ≥ 280 px
 *  - Natural width  ≥ 300 px
 *  - Natural height ≥ 300 px
 *  - Rendered area   ≥ 100 000 px²
 *  - Not a logo, avatar, icon, emoji, ad, favicon, etc.
 */
export function isMangaImageCandidate(
  image: HTMLImageElement,
  alreadyRegistered: WeakSet<HTMLImageElement> = new WeakSet()
): boolean {
  // Skip elements already tracked by the current scan session.
  if (alreadyRegistered.has(image)) {
    return false;
  }

  // ── Visibility checks ──────────────────────────────────────
  const style = window.getComputedStyle(image);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) < 0.1) return false;

  // Check that the element (or a close ancestor) is not hidden.
  const rect = image.getBoundingClientRect();
  if (rect.width < MIN_RENDERED_WIDTH) return false;
  if (rect.height < MIN_RENDERED_HEIGHT) return false;
  if (rect.width * rect.height < MIN_RENDERED_AREA) return false;

  // ── Natural (intrinsic) size checks ────────────────────────
  // Use naturalWidth / naturalHeight which are 0 for broken images.
  if (image.naturalWidth < MIN_NATURAL_WIDTH) return false;
  if (image.naturalHeight < MIN_NATURAL_HEIGHT) return false;

  // ── Non-content image heuristics ───────────────────────────
  if (looksLikeNonContent(image)) return false;

  // ── Container visibility ───────────────────────────────────
  if (isInsideHiddenContainer(image)) return false;

  return true;
}

/**
 * Heuristic: does the element look like a logo / icon / avatar / ad?
 */
function looksLikeNonContent(img: HTMLImageElement): boolean {
  const className = (img.className ?? "").toLowerCase();
  const alt = (img.alt ?? "").toLowerCase();
  const role = img.getAttribute("role") ?? "";
  const ariaLabel = (img.getAttribute("aria-label") ?? "").toLowerCase();

  const combined = `${className} ${alt} ${role} ${ariaLabel}`;
  for (const pattern of NON_CONTENT_PATTERNS) {
    if (combined.includes(pattern)) return true;
  }

  // Very small rendered size even if it meets the area threshold
  // (e.g. a 500×500 image scaled to 1×1 — caught by rect checks above,
  //  but also guard against tracking-pixel-like broken layouts).
  if (img.width > 0 && img.width < 32 && img.height > 0 && img.height < 32) {
    return true;
  }

  // Favicon: typically 16–32 px and in <head> or with rel="icon".
  // Our rect/area checks already filter most of these out.

  return false;
}

/**
 * Walk up the DOM to see if an ancestor hides this image.
 */
function isInsideHiddenContainer(el: HTMLImageElement): boolean {
  // Limit walk to avoid performance issues on deep DOMs.
  let current: Element | null = el.parentElement;
  let depth = 0;
  while (current && depth < 5) {
    const style = window.getComputedStyle(current);
    if (style.display === "none") return true;
    if (style.visibility === "hidden") return true;
    if (parseFloat(style.opacity) < 0.1) return true;
    current = current.parentElement;
    depth++;
  }
  return false;
}

/**
 * Scan the entire document for manga image candidates.
 * Returns an array of qualifying HTMLImageElement references.
 */
export function scanPageForMangaImages(
  alreadyRegistered: WeakSet<HTMLImageElement> = new WeakSet()
): HTMLImageElement[] {
  const images = document.querySelectorAll<HTMLImageElement>("img");
  const candidates: HTMLImageElement[] = [];

  for (const img of images) {
    // Skip images injected by the extension itself.
    if (img.closest("[data-mangalens-root]")) continue;
    if (isMangaImageCandidate(img, alreadyRegistered)) {
      candidates.push(img);
    }
  }

  return candidates;
}