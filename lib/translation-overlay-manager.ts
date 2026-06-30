import { normalizedToViewportRect } from "@/lib/image-position";
import type { TranslationBubble } from "@/types/translation";

const ROOT_ID = "mangalens-translation-overlay-root";

interface PageOverlay {
  readonly image: HTMLImageElement;
  readonly bubbles: TranslationBubble[];
  readonly elements: HTMLElement[];
}

export class TranslationOverlayManager {
  private root: HTMLElement | null = null;
  private readonly pages = new Map<string, PageOverlay>();
  private visible = true;
  private listening = false;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private animationFrame: number | null = null;
  private readonly scheduleUpdate = () => {
    if (this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      this.updateAllPositions();
    });
  };

  renderPage(
    pageId: string,
    image: HTMLImageElement,
    bubbles: TranslationBubble[]
  ): void {
    this.removePage(pageId);
    const root = this.ensureRoot();
    const elements = bubbles.map((bubble) => {
      const element = document.createElement("div");
      element.className = "mangalens-translation-bubble";
      element.textContent = bubble.translatedText;
      element.title = bubble.originalText;
      Object.assign(element.style, {
        position: "absolute",
        boxSizing: "border-box",
        display: this.visible ? "flex" : "none",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 8px",
        background: "rgba(255, 255, 252, 0.96)",
        color: "#17202a",
        border: "1px solid rgba(80, 86, 92, 0.55)",
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.22)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "clamp(11px, 1.4vw, 18px)",
        fontWeight: "600",
        lineHeight: "1.2",
        textAlign: "center",
        overflow: "hidden",
        pointerEvents: "none",
      } as CSSStyleDeclaration);
      root.appendChild(element);
      return element;
    });
    this.pages.set(pageId, { image, bubbles, elements });
    this.startListening();
    this.resizeObserver?.observe(image);
    this.positionPage(this.pages.get(pageId)!);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.root) this.root.style.display = visible ? "block" : "none";
  }

  removePage(pageId: string): void {
    const page = this.pages.get(pageId);
    if (!page) return;
    this.resizeObserver?.unobserve(page.image);
    for (const element of page.elements) element.remove();
    this.pages.delete(pageId);
  }

  clear(): void {
    for (const pageId of [...this.pages.keys()]) this.removePage(pageId);
    this.stopListening();
    this.root?.remove();
    this.root = null;
  }

  get pageCount(): number {
    return this.pages.size;
  }

  updateAllPositions(): void {
    for (const [pageId, page] of this.pages) {
      if (!document.contains(page.image)) {
        this.removePage(pageId);
      } else {
        this.positionPage(page);
      }
    }
  }

  private ensureRoot(): HTMLElement {
    if (this.root) return this.root;
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      this.root = existing;
      return existing;
    }
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.dataset.mangalensTranslationRoot = "true";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "2147483641",
      display: this.visible ? "block" : "none",
    } as CSSStyleDeclaration);
    document.documentElement.appendChild(root);
    this.root = root;
    return root;
  }

  private positionPage(page: PageOverlay): void {
    const imageRect = page.image.getBoundingClientRect();
    page.bubbles.forEach((bubble, index) => {
      const rect = normalizedToViewportRect(imageRect, bubble.bounds);
      Object.assign(page.elements[index].style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      } as CSSStyleDeclaration);
    });
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("scroll", this.scheduleUpdate, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", this.scheduleUpdate, { passive: true });
    this.resizeObserver = new ResizeObserver(this.scheduleUpdate);
    this.mutationObserver = new MutationObserver(this.scheduleUpdate);
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private stopListening(): void {
    if (!this.listening) return;
    window.removeEventListener("scroll", this.scheduleUpdate, true);
    window.removeEventListener("resize", this.scheduleUpdate);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver = null;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.listening = false;
  }
}
