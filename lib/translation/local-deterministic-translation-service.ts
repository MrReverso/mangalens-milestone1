import type { TranslationBubble } from "@/types/translation";
import {
  validateTranslationApiRequestMetadata,
} from "@/types/translation-api";
import type {
  LocalTranslationInput,
  TranslationService,
} from "@/lib/translation/translation-service";

interface TempRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

function groupTextRegions(
  regions: TempRegion[],
  pixelWidth: number,
  pixelHeight: number
): TempRegion[] {
  if (regions.length === 0) return [];

  let current = [...regions];
  let merged = true;

  const maxGapX = pixelWidth * 0.08;
  const maxGapY = pixelHeight * 0.08;

  while (merged) {
    merged = false;
    const next: TempRegion[] = [];
    const visited = new Set<number>();

    for (let i = 0; i < current.length; i++) {
      if (visited.has(i)) continue;
      let group = [current[i]];
      visited.add(i);

      for (let j = i + 1; j < current.length; j++) {
        if (visited.has(j)) continue;

        const close = group.some((member) => {
          const memberRight = member.x + member.width;
          const memberBottom = member.y + member.height;
          const candidateRight = current[j].x + current[j].width;
          const candidateBottom = current[j].y + current[j].height;

          const overlapX = Math.max(
            0,
            Math.min(memberRight, candidateRight) - Math.max(member.x, current[j].x)
          );
          const overlapY = Math.max(
            0,
            Math.min(memberBottom, candidateBottom) - Math.max(member.y, current[j].y)
          );

          const gapX = overlapX > 0 ? 0 : Math.max(member.x, current[j].x) - Math.min(memberRight, candidateRight);
          const gapY = overlapY > 0 ? 0 : Math.max(member.y, current[j].y) - Math.min(memberBottom, candidateBottom);

          return gapX <= maxGapX && gapY <= maxGapY;
        });

        if (close) {
          group.push(current[j]);
          visited.add(j);
          merged = true;
        }
      }

      const minX = Math.min(...group.map((r) => r.x));
      const minY = Math.min(...group.map((r) => r.y));
      const maxX = Math.max(...group.map((r) => r.x + r.width));
      const maxY = Math.max(...group.map((r) => r.y + r.height));

      const sortedGroup = [...group].sort((a, b) => {
        if (Math.abs(a.y - b.y) > 10) {
          return a.y - b.y;
        }
        return a.x - b.x;
      });
      const text = sortedGroup.map((r) => r.text).join("\n");

      next.push({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        text,
      });
    }
    current = next;
  }

  return current;
}

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

    if (typeof (globalThis as any).TextDetector === "undefined") {
      throw new Error("ocr-unavailable");
    }

    let imageBitmap: ImageBitmap;
    try {
      imageBitmap = await createImageBitmap(input.image);
    } catch {
      throw new Error("invalid-image");
    }

    let detected: any[];
    try {
      const detector = new (globalThis as any).TextDetector();
      detected = await detector.detect(imageBitmap);
    } catch {
      throw new Error("ocr-unavailable");
    }

    if (detected.length === 0) {
      throw new Error("ocr-no-text");
    }

    const tempRegions: TempRegion[] = detected.map((d: any) => ({
      x: d.boundingBox.x,
      y: d.boundingBox.y,
      width: d.boundingBox.width,
      height: d.boundingBox.height,
      text: d.rawValue,
    }));

    const grouped = groupTextRegions(
      tempRegions,
      imageBitmap.width,
      imageBitmap.height
    );

    if (grouped.length === 0) {
      throw new Error("ocr-no-text");
    }

    const bubbles: TranslationBubble[] = grouped.map((g, index) => ({
      id: `${metadata.pageId}-local-${index + 1}`,
      bounds: {
        x: g.x / imageBitmap.width,
        y: g.y / imageBitmap.height,
        width: g.width / imageBitmap.width,
        height: g.height / imageBitmap.height,
      },
      originalText: g.text,
      translatedText: g.text,
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
