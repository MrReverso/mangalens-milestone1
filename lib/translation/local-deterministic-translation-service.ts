import type { TargetLanguage } from "@/types/extension";
import type { TranslationBubble } from "@/types/translation";
import {
  validateTranslationApiRequestMetadata,
} from "@/types/translation-api";
import type {
  LocalTranslationInput,
  TranslationService,
} from "@/lib/translation/translation-service";

const DEMO_TEXT: Record<TargetLanguage, readonly [string, string, string]> = {
  en: ["We finally made it.", "Stay alert.", "This is only the beginning."],
  es: ["Por fin llegamos.", "Mantente alerta.", "Esto es solo el comienzo."],
  pt: ["Finalmente chegamos.", "Fique alerta.", "Isto é apenas o começo."],
  fr: ["Nous y sommes enfin.", "Reste sur tes gardes.", "Ce n’est que le début."],
  it: ["Ce l’abbiamo finalmente fatta.", "Resta in guardia.", "Questo è solo l’inizio."],
  de: ["Wir haben es endlich geschafft.", "Bleib wachsam.", "Das ist erst der Anfang."],
};

const BOUNDS = [
  { x: 0.08, y: 0.08, width: 0.34, height: 0.13 },
  { x: 0.58, y: 0.24, width: 0.32, height: 0.12 },
  { x: 0.31, y: 0.73, width: 0.38, height: 0.13 },
] as const;

export class LocalDeterministicTranslationService
implements TranslationService {
  constructor(private readonly delayMs = 120) {}

  async translate(
    input: LocalTranslationInput,
    signal: AbortSignal
  ): Promise<unknown> {
    throwIfAborted(signal);
    if (input.image.type !== "image/png" || input.image.size <= 0) {
      throw new Error("invalid-image");
    }
    const metadata = validateTranslationApiRequestMetadata(input.metadata);
    if (!metadata) throw new Error("invalid-metadata");
    await abortableDelay(this.delayMs, signal);
    throwIfAborted(signal);

    const text = DEMO_TEXT[metadata.targetLanguage];
    const bubbles: TranslationBubble[] = text.map((translatedText, index) => ({
      id: `${metadata.pageId}-local-${index + 1}`,
      bounds: BOUNDS[index],
      originalText: `Local demo source ${index + 1}`,
      translatedText,
    }));
    return {
      contractVersion: 1,
      requestId: metadata.requestId,
      pageId: metadata.pageId,
      bubbles,
    };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Local translation cancelled", "AbortError");
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Local translation cancelled", "AbortError"));
    };
    const onComplete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    timer = setTimeout(onComplete, ms);
    if (signal.aborted) onAbort();
  });
}
