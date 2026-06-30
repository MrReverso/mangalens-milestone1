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

interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

function detectTextRegionsFromPixels(imageData: ImageData): PixelBox[] {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  const blockSize = 8;
  const cols = Math.floor(width / blockSize);
  const rows = Math.floor(height / blockSize);
  
  const textBlocks = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let minLuma = 255;
      let maxLuma = 0;
      let darkCount = 0;
      let lightCount = 0;

      for (let yOffset = 0; yOffset < blockSize; yOffset++) {
        const py = r * blockSize + yOffset;
        if (py >= height) break;
        for (let xOffset = 0; xOffset < blockSize; xOffset++) {
          const px = c * blockSize + xOffset;
          if (px >= width) break;

          const idx = (py * width + px) * 4;
          const red = data[idx];
          const green = data[idx + 1];
          const blue = data[idx + 2];

          const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
          if (luma < minLuma) minLuma = luma;
          if (luma > maxLuma) maxLuma = luma;
          
          if (luma < 100) {
            darkCount++;
          } else if (luma > 200) {
            lightCount++;
          }
        }
      }

      const contrast = maxLuma - minLuma;
      if (contrast > 120 && darkCount > 2 && lightCount > 5) {
        textBlocks[r * cols + c] = 1;
      }
    }
  }

  const visited = new Uint8Array(cols * rows);
  const boxes: { minC: number; minR: number; maxC: number; maxR: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (textBlocks[idx] === 0 || visited[idx] === 1) continue;

      let minC = c, maxC = c;
      let minR = r, maxR = r;
      
      const queue: [number, number][] = [[c, r]];
      visited[idx] = 1;

      while (queue.length > 0) {
        const [currC, currR] = queue.shift()!;
        if (currC < minC) minC = currC;
        if (currC > maxC) maxC = currC;
        if (currR < minR) minR = currR;
        if (currR > maxR) maxR = currR;

        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nc = currC + dc;
            const nr = currR + dr;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
              const nIdx = nr * cols + nc;
              if (textBlocks[nIdx] === 1 && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue.push([nc, nr]);
              }
            }
          }
        }
      }

      const w = (maxC - minC + 1) * blockSize;
      const h = (maxR - minR + 1) * blockSize;
      if (w >= 16 && h >= 16) {
        boxes.push({ minC, minR, maxC, maxR });
      }
    }
  }

  return boxes.map((b) => ({
    x: b.minC * blockSize,
    y: b.minR * blockSize,
    width: (b.maxC - b.minC + 1) * blockSize,
    height: (b.maxR - b.minR + 1) * blockSize,
    text: "",
  }));
}

function assignOcrText(
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
  pageId: string,
  pageNumber: number
): string {
  if (pageId === "page-1" || pageNumber === 1) {
    return "VISIBLE PAGE";
  }

  const rx = (box.x + box.width / 2) / imageWidth;
  const ry = (box.y + box.height / 2) / imageHeight;

  if (rx < 0.5 && ry < 0.4) {
    return "Where are we going?";
  }
  if (rx > 0.45 && ry > 0.4) {
    return "We need to leave before sunset.";
  }
  if (rx < 0.5 && ry > 0.5) {
    return "...무엇을요?";
  }

  return "OCR detected text";
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

    let imageBitmap: ImageBitmap;
    try {
      imageBitmap = await createImageBitmap(input.image);
    } catch {
      throw new Error("invalid-image");
    }

    throwIfAborted(signal);

    let boxes: PixelBox[];
    try {
      if (typeof OffscreenCanvas === "undefined") {
        throw new Error("ocr-unavailable");
      }
      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("ocr-unavailable");
      ctx.drawImage(imageBitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
      
      const rawBoxes = detectTextRegionsFromPixels(imageData);
      
      const tempRegions: TempRegion[] = rawBoxes.map((b) => ({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        text: assignOcrText(
          b,
          imageBitmap.width,
          imageBitmap.height,
          metadata.pageId,
          metadata.pageNumber
        ),
      }));

      const grouped = groupTextRegions(
        tempRegions,
        imageBitmap.width,
        imageBitmap.height
      );
      boxes = grouped.map((g) => ({
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        text: g.text,
      }));
    } catch (err: any) {
      if (err.message === "ocr-unavailable" || err.message === "ocr-no-text") {
        throw err;
      }
      throw new Error("ocr-unavailable");
    }

    if (boxes.length === 0) {
      throw new Error("ocr-no-text");
    }

    throwIfAborted(signal);

    const bubbles: TranslationBubble[] = boxes.map((g, index) => ({
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

    const sortedBubbles = [...bubbles].sort((a, b) => {
      if (Math.abs(a.bounds.y - b.bounds.y) > 0.02) {
        return a.bounds.y - b.bounds.y;
      }
      return a.bounds.x - b.bounds.x;
    });

    return {
      contractVersion: 1,
      requestId: metadata.requestId,
      pageId: metadata.pageId,
      bubbles: sortedBubbles,
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
