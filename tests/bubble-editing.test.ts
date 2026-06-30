import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TranslationOverlayManager,
  type TranslationOverlayCallbacks,
} from "@/lib/translation-overlay-manager";
import { MAX_TRANSLATION_TEXT_LENGTH } from "@/lib/translation-text";
import type { TranslationBubble } from "@/types/translation";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const bubbles: TranslationBubble[] = [
  {
    id: "bubble-1",
    bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.12 },
    originalText: "Original one",
    translatedText: "First translation",
  },
  {
    id: "bubble-2",
    bounds: { x: 0.5, y: 0.3, width: 0.3, height: 0.12 },
    originalText: "Original two",
    translatedText: "Second translation",
  },
];

describe("translation bubble editing", () => {
  let image: HTMLImageElement;
  let commit: TranslationOverlayCallbacks["onCommitEdit"];
  let callbacks: TranslationOverlayCallbacks;
  let manager: TranslationOverlayManager;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.querySelector("[data-mangalens-translation-root]")?.remove();
    document.body.replaceChildren();
    image = document.createElement("img");
    document.body.appendChild(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 20, 800, 1200)
    );
    commit = vi.fn((
      _pageId: string,
      _bubbleId: string,
      _translatedText: string
    ): boolean => true);
    callbacks = { onCommitEdit: commit };
    manager = new TranslationOverlayManager(callbacks);
    manager.renderPage("page-1", image, bubbles);
  });

  afterEach(() => {
    manager.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function bubble(index = 0): HTMLElement {
    return document.querySelectorAll<HTMLElement>(
      ".mangalens-translation-bubble"
    )[index];
  }

  function textarea(): HTMLTextAreaElement {
    const editor = document.querySelector<HTMLTextAreaElement>("textarea");
    if (!editor) throw new Error("Expected active textarea");
    return editor;
  }

  it("clicking a bubble opens a focused textarea with its current text", () => {
    bubble().click();
    expect(textarea().value).toBe("First translation");
    expect(document.activeElement).toBe(textarea());
    expect(textarea().getAttribute("aria-label"))
      .toBe("Edit translated manga text");
  });

  it("Enter saves normalized text exactly once", () => {
    bubble().click();
    textarea().value = "  Updated translation  ";
    textarea().dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(
      "page-1",
      "bubble-1",
      "Updated translation"
    );
    expect(bubble().textContent).toBe("Updated translation");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Shift+Enter keeps editing and preserves a newline", () => {
    bubble().click();
    textarea().value = "Line one\nLine two";
    textarea().dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
    }));
    expect(manager.isEditing).toBe(true);
    expect(textarea().value).toBe("Line one\nLine two");
    expect(commit).not.toHaveBeenCalled();
  });

  it("saves and visibly preserves multiline text through hide and reopen", () => {
    bubble().click();
    textarea().value = "Line one\nLine two";
    textarea().dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    }));
    expect(bubble().textContent).toBe("Line one\nLine two");
    expect(bubble().style.whiteSpace).toBe("pre-wrap");
    expect(bubble().style.overflowWrap).toBe("anywhere");

    manager.setVisible(false);
    manager.setVisible(true);
    expect(bubble().textContent).toBe("Line one\nLine two");
    bubble().click();
    expect(textarea().value).toBe("Line one\nLine two");
  });

  it("Escape cancels and restores the previous text", () => {
    bubble().click();
    textarea().value = "Discard me";
    textarea().dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
    }));
    expect(commit).not.toHaveBeenCalled();
    expect(bubble().textContent).toBe("First translation");
  });

  it("blur saves a valid edit", () => {
    bubble().click();
    textarea().value = "Saved on blur";
    textarea().dispatchEvent(new FocusEvent("blur"));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(bubble().textContent).toBe("Saved on blur");
  });

  it("Enter followed by blur cannot commit twice", () => {
    bubble().click();
    const editor = textarea();
    editor.value = "One commit";
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    }));
    editor.dispatchEvent(new FocusEvent("blur"));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("rejects whitespace-only edits and restores previous text", () => {
    bubble().click();
    textarea().value = " \n\t ";
    textarea().dispatchEvent(new FocusEvent("blur"));
    expect(commit).not.toHaveBeenCalled();
    expect(bubble().textContent).toBe("First translation");
  });

  it("rejects over-limit edits without replacing text", () => {
    bubble().click();
    textarea().value = "x".repeat(MAX_TRANSLATION_TEXT_LENGTH + 1);
    textarea().dispatchEvent(new FocusEvent("blur"));
    expect(commit).not.toHaveBeenCalled();
    expect(bubble().textContent).toBe("First translation");
  });

  it("clicking another bubble saves the first and edits only the second", () => {
    bubble(0).click();
    textarea().value = "Saved first";
    bubble(1).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    bubble(1).click();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(bubble(0).textContent).toBe("Saved first");
    expect(bubble(1).querySelector("textarea")).not.toBeNull();
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("clicking outside saves without blocking the website click", () => {
    const websiteButton = document.createElement("button");
    const websiteClick = vi.fn();
    websiteButton.addEventListener("click", websiteClick);
    document.body.appendChild(websiteButton);
    bubble().click();
    textarea().value = "Saved outside";
    websiteButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    websiteButton.click();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(websiteClick).toHaveBeenCalledTimes(1);
    expect(bubble().textContent).toBe("Saved outside");
  });

  it("hiding while editing saves, and showing preserves the edit", () => {
    bubble().click();
    textarea().value = "Survives visibility";
    manager.setVisible(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(manager.isEditing).toBe(false);
    manager.setVisible(true);
    expect(bubble().textContent).toBe("Survives visibility");
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(2);
  });

  it("saved text remains while the bubble is repositioned", () => {
    bubble().click();
    textarea().value = "Position-safe edit";
    textarea().dispatchEvent(new FocusEvent("blur"));
    vi.mocked(image.getBoundingClientRect).mockReturnValue(
      new DOMRect(40, 80, 600, 900)
    );
    manager.updateAllPositions();
    expect(bubble().textContent).toBe("Position-safe edit");
    expect(bubble().style.left).toBe("100px");
  });

  it("removing a page closes its editor and removes its bubbles", () => {
    bubble().click();
    manager.removePage("page-1");
    expect(manager.isEditing).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelectorAll(".mangalens-translation-bubble"))
      .toHaveLength(0);
  });

  it("clear closes the editor and removes the document listener", () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    bubble().click();
    manager.clear();
    expect(manager.isEditing).toBe(false);
    expect(removeListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true
    );
  });

  it("repeated editing does not create duplicate document listeners", () => {
    manager.clear();
    const addListener = vi.spyOn(document, "addEventListener");
    manager = new TranslationOverlayManager(callbacks);
    manager.renderPage("page-1", image, bubbles);
    for (let index = 0; index < 3; index++) {
      bubble().click();
      textarea().dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }));
    }
    expect(addListener.mock.calls.filter(([type]) => type === "mousedown"))
      .toHaveLength(1);
  });

  it("uses safe controls without contenteditable or HTML rendering", () => {
    bubble().click();
    textarea().value = "<img src=x onerror=alert(1)>";
    textarea().dispatchEvent(new FocusEvent("blur"));
    expect(bubble().querySelector("img")).toBeNull();
    expect(bubble().hasAttribute("contenteditable")).toBe(false);
    expect(bubble().textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
