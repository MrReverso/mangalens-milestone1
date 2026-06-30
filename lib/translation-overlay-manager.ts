import { normalizedToViewportRect } from "@/lib/image-position";
import { normalizeTranslationText } from "@/lib/translation-text";
import type { TranslationBubble } from "@/types/translation";

const ROOT_ID = "mangalens-translation-overlay-root";

interface PageOverlay {
  readonly image: HTMLImageElement;
  bubbles: TranslationBubble[];
  readonly elements: HTMLElement[];
}

export interface TranslationOverlayCallbacks {
  readonly onCommitEdit: (
    pageId: string,
    bubbleId: string,
    translatedText: string
  ) => boolean;
  readonly onCancelEdit?: (pageId: string, bubbleId: string) => void;
}

interface ActiveEditor {
  readonly pageId: string;
  readonly bubbleId: string;
  readonly element: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly previousText: string;
}

export class TranslationOverlayManager {
  private root: HTMLElement | null = null;
  private readonly pages = new Map<string, PageOverlay>();
  private visible = true;
  private listening = false;
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private animationFrame: number | null = null;
  private activeEditor: ActiveEditor | null = null;
  private readonly callbacks: TranslationOverlayCallbacks;
  private readonly outsideClickHandler = (event: MouseEvent) => {
    if (!this.activeEditor) return;
    if (this.activeEditor.element.contains(event.target as Node)) return;
    this.finishEditing(true);
  };
  private readonly scheduleUpdate = () => {
    if (this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      this.updateAllPositions();
    });
  };

  constructor(callbacks?: TranslationOverlayCallbacks) {
    this.callbacks = callbacks ?? { onCommitEdit: () => false };
  }

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
      element.dataset.pageId = pageId;
      element.dataset.bubbleId = bubble.id;
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      element.setAttribute(
        "aria-label",
        `Edit translated manga text: ${bubble.originalText}`
      );
      Object.assign(element.style, {
        position: "absolute",
        boxSizing: "border-box",
        display: "flex",
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
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        overflow: "hidden",
        pointerEvents: "auto",
        cursor: "text",
      } as CSSStyleDeclaration);
      element.addEventListener("click", () => {
        this.beginEditing(pageId, bubble.id, element);
      });
      element.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") &&
            !this.activeEditor) {
          event.preventDefault();
          this.beginEditing(pageId, bubble.id, element);
        }
      });
      root.appendChild(element);
      return element;
    });
    this.pages.set(pageId, { image, bubbles, elements });
    this.startListening();
    this.resizeObserver?.observe(image);
    this.positionPage(this.pages.get(pageId)!);
  }

  setVisible(visible: boolean): void {
    if (!visible) this.finishEditing(true);
    this.visible = visible;
    if (this.root) this.root.style.display = visible ? "block" : "none";
  }

  removePage(pageId: string): void {
    const page = this.pages.get(pageId);
    if (!page) return;
    if (this.activeEditor?.pageId === pageId) this.finishEditing(false);
    this.resizeObserver?.unobserve(page.image);
    for (const element of page.elements) element.remove();
    this.pages.delete(pageId);
    this.cleanupWhenEmpty();
  }

  clear(): void {
    this.finishEditing(false);
    for (const pageId of [...this.pages.keys()]) this.removePage(pageId);
    this.stopListening();
    this.root?.remove();
    this.root = null;
  }

  get pageCount(): number {
    return this.pages.size;
  }

  get isEditing(): boolean {
    return this.activeEditor !== null;
  }

  updateBubbleText(
    pageId: string,
    bubbleId: string,
    translatedText: string
  ): boolean {
    const page = this.pages.get(pageId);
    if (!page) return false;
    const bubbleIndex = page.bubbles.findIndex(
      (bubble) => bubble.id === bubbleId
    );
    if (bubbleIndex < 0) return false;
    page.bubbles = page.bubbles.map((bubble, index) =>
      index === bubbleIndex
        ? { ...bubble, translatedText }
        : bubble
    );
    page.elements[bubbleIndex].textContent = translatedText;
    return true;
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
    document.addEventListener("mousedown", this.outsideClickHandler, true);
  }

  private stopListening(): void {
    if (!this.listening) return;
    window.removeEventListener("scroll", this.scheduleUpdate, true);
    window.removeEventListener("resize", this.scheduleUpdate);
    document.removeEventListener("mousedown", this.outsideClickHandler, true);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver = null;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.listening = false;
  }

  private cleanupWhenEmpty(): void {
    if (this.pages.size > 0) return;
    this.stopListening();
    this.root?.remove();
    this.root = null;
  }

  private beginEditing(
    pageId: string,
    bubbleId: string,
    element: HTMLElement
  ): void {
    if (this.activeEditor?.element === element) return;
    this.finishEditing(true);

    const previousText = element.textContent ?? "";
    const textarea = document.createElement("textarea");
    textarea.value = previousText;
    textarea.setAttribute("aria-label", "Edit translated manga text");
    textarea.spellcheck = true;
    Object.assign(textarea.style, {
      width: "100%",
      height: "100%",
      boxSizing: "border-box",
      resize: "none",
      overflow: "auto",
      border: "1px solid #5b8def",
      borderRadius: "5px",
      outline: "2px solid rgba(91, 141, 239, 0.35)",
      background: "rgba(255, 255, 252, 0.98)",
      color: "inherit",
      font: "inherit",
      lineHeight: "inherit",
      textAlign: "center",
      padding: "4px",
      pointerEvents: "auto",
    } as CSSStyleDeclaration);
    element.textContent = "";
    element.appendChild(textarea);
    this.activeEditor = {
      pageId,
      bubbleId,
      element,
      textarea,
      previousText,
    };

    textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.finishEditing(false);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.finishEditing(true);
      }
    });
    textarea.addEventListener("blur", () => this.finishEditing(true));
    textarea.focus();
  }

  private finishEditing(save: boolean): void {
    const editor = this.activeEditor;
    if (!editor) return;
    this.activeEditor = null;

    let displayText = editor.previousText;
    if (save) {
      const normalized = normalizeTranslationText(editor.textarea.value);
      if (normalized &&
          this.callbacks.onCommitEdit(
            editor.pageId,
            editor.bubbleId,
            normalized
          )) {
        displayText = normalized;
      }
    } else {
      this.callbacks.onCancelEdit?.(editor.pageId, editor.bubbleId);
    }
    editor.textarea.remove();
    editor.element.textContent = displayText;
  }
}
