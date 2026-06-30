import type {
  TranslatePageInput,
  TranslatePageResult,
  TranslationBubble,
  TranslationProvider,
} from "@/types/translation";
import type { TargetLanguage } from "@/types/extension";
import { validateNormalizedRect } from "@/types/translation";

const MOCK_TEXT: Record<TargetLanguage, readonly [string, string]> = {
  en: ["Where are we going?", "We need to leave before sunset."],
  es: ["¿A dónde vamos?", "Tenemos que irnos antes del atardecer."],
  pt: ["Para onde estamos indo?", "Precisamos sair antes do pôr do sol."],
  fr: ["Où allons-nous ?", "Nous devons partir avant le coucher du soleil."],
  it: ["Dove stiamo andando?", "Dobbiamo partire prima del tramonto."],
  de: ["Wohin gehen wir?", "Wir müssen vor Sonnenuntergang gehen."],
};

const BOUNDS = [
  validateNormalizedRect({ x: 0.10, y: 0.08, width: 0.32, height: 0.11 }),
  validateNormalizedRect({ x: 0.55, y: 0.32, width: 0.34, height: 0.12 }),
] as const;

export class MockTranslationProvider implements TranslationProvider {
  constructor(private readonly delayMs = 400) {}

  async translatePage(
    input: TranslatePageInput,
    signal: AbortSignal
  ): Promise<TranslatePageResult> {
    await abortableDelay(this.delayMs, signal);
    const text = MOCK_TEXT[input.targetLanguage];
    const bubbles: TranslationBubble[] = text.map((translatedText, index) => ({
      id: `${input.pageId}-bubble-${index + 1}`,
      bounds: BOUNDS[index],
      originalText: `Mock source text ${index + 1}`,
      translatedText,
    }));
    return { pageId: input.pageId, bubbles };
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Translation cancelled", "AbortError"));
    };

    const onComplete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    timer = setTimeout(onComplete, ms);

    // Recheck after timer setup so an abort around listener registration
    // cannot leave a live timer or resolve cancelled work.
    if (signal.aborted) onAbort();
  });
}
