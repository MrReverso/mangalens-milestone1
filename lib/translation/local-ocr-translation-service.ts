// @ts-ignore
import Tesseract from '@/public/tesseract/tesseract.esm.min.js';
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
      let head = 0;
      visited[idx] = 1;

      while (head < queue.length) {
        const [currC, currR] = queue[head++];
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
  }));
}

function mapLanguage(lang: string): string {
  switch (lang) {
    case "ja":
      return "jpn+jpn_vert";
    case "ko":
      return "kor";
    case "zh":
      return "chi_sim";
    case "en":
      return "eng";
    case "auto":
    default:
      return "eng+jpn+jpn_vert+kor+chi_sim";
  }
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

let activeScansCount = 0;
let isClosing = false;
let offscreenClosePromise: Promise<void> | null = null;
let offscreenCreationPromise: Promise<void> | null = null;

async function registerScanStart(): Promise<void> {
  if (isClosing && offscreenClosePromise) {
    await offscreenClosePromise;
  }
  activeScansCount++;
  await ensureOffscreenDocument();
}

async function registerScanEnd(): Promise<void> {
  activeScansCount--;
  if (activeScansCount <= 0) {
    activeScansCount = 0;
    isClosing = true;
    offscreenClosePromise = (async () => {
      try {
        await chrome.offscreen.closeDocument();
      } catch (err) {
        console.error("Failed to close offscreen document:", err);
      } finally {
        isClosing = false;
        offscreenClosePromise = null;
      }
    })();
    await offscreenClosePromise;
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreationPromise) {
    return offscreenCreationPromise;
  }

  offscreenCreationPromise = (async () => {
    const offscreenUrl = 'offscreen.html';
    if (typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as any]
      });
      const exists = contexts.some((c) => c.documentUrl?.endsWith(offscreenUrl));
      if (exists) {
        return;
      }
    }
    
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['WORKERS' as any],
      justification: 'Run local Tesseract OCR in a dedicated worker.'
    });
  })();

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = null;
  }
}

async function runWithAbortAndTimeout<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  workerRef: { worker: any }
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException("Local translation cancelled", "AbortError");
  }

  let onAbort: () => void;
  let timer: any;
  let settled = false;

  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      if (settled) return;
      settled = true;
      if (workerRef.worker) {
        workerRef.worker.terminate().catch(() => {});
        workerRef.worker = null;
      }
      reject(new DOMException("Local translation cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (workerRef.worker) {
        workerRef.worker.terminate().catch(() => {});
        workerRef.worker = null;
      }
      reject(new Error("ocr-timeout"));
    }, timeoutMs);
  });

  const taskPromise = (async () => {
    const res = await task();
    if (settled) {
      if (res && typeof (res as any).terminate === "function") {
        (res as any).terminate().catch(() => {});
      } else if (workerRef.worker) {
        workerRef.worker.terminate().catch(() => {});
        workerRef.worker = null;
      }
      throw new DOMException("Local translation cancelled", "AbortError");
    }
    settled = true;
    return res;
  })();

  try {
    return await Promise.race([taskPromise, abortPromise, timeoutPromise]);
  } finally {
    signal.removeEventListener("abort", onAbort!);
    clearTimeout(timer);
  }
}

export class LocalOcrTranslationService
implements TranslationService {
  constructor(private readonly delayMs = 120) {}

  async translate(
    input: LocalTranslationInput,
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) {
      throw new DOMException("Local translation cancelled", "AbortError");
    }
    if (input.image.type !== "image/png" || input.image.size <= 0) {
      throw new Error("invalid-image");
    }
    const metadata = validateTranslationApiRequestMetadata(input.metadata);
    if (!metadata) throw new Error("invalid-metadata");
    await abortableDelay(this.delayMs, signal);
    if (signal.aborted) {
      throw new DOMException("Local translation cancelled", "AbortError");
    }

    const startTimestamp = Date.now();
    const totalDeadlineMs = 28000;
    const deadlineTimestamp = startTimestamp + totalDeadlineMs;

    const getRemainingTime = () => {
      return Math.max(0, deadlineTimestamp - Date.now());
    };

    const isServiceWorker =
      typeof chrome !== 'undefined' &&
      typeof chrome.offscreen !== 'undefined' &&
      typeof window === 'undefined';

    if (isServiceWorker) {
      // Background SW delegates to offscreen document
      const buffer = await input.image.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${input.image.type};base64,${base64}`;

      await registerScanStart();

      let onAbort: () => void;
      let timer: any;
      let settled = false;

      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          if (settled) return;
          settled = true;
          chrome.runtime.sendMessage({
            target: 'offscreen-ocr',
            action: 'abort',
            requestId: metadata.requestId,
          }).catch(() => {});
          reject(new DOMException("Local translation cancelled", "AbortError"));
        };
        signal.addEventListener("abort", onAbort);
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          chrome.runtime.sendMessage({
            target: 'offscreen-ocr',
            action: 'abort',
            requestId: metadata.requestId,
          }).catch(() => {});
          reject(new Error("ocr-timeout"));
        }, getRemainingTime());
      });

      const scanPromise = (async () => {
        const resp: any = await chrome.runtime.sendMessage({
          target: 'offscreen-ocr',
          action: 'scan',
          requestId: metadata.requestId,
          imageBase64: dataUrl,
          metadata,
        });
        if (settled) throw new DOMException("Local translation cancelled", "AbortError");
        settled = true;
        if (!resp || !resp.success) {
          throw new Error(resp?.error || 'ocr-unavailable');
        }
        return resp.result;
      })();

      try {
        return await Promise.race([scanPromise, abortPromise, timeoutPromise]);
      } finally {
        signal.removeEventListener("abort", onAbort!);
        clearTimeout(timer);
        await registerScanEnd();
      }
    }

    // Offscreen document or Test Context runs Tesseract locally
    let imageBitmap: ImageBitmap | null = null;
    const workerRef = { worker: null as any };

    try {
      try {
        imageBitmap = await createImageBitmap(input.image);
      } catch {
        throw new Error("invalid-image");
      }

      if (signal.aborted) {
        throw new DOMException("Local translation cancelled", "AbortError");
      }

      if (typeof OffscreenCanvas === "undefined") {
        throw new Error("ocr-unavailable");
      }

      const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("ocr-unavailable");
      ctx.drawImage(imageBitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);
      
      const rawBoxes = detectTextRegionsFromPixels(imageData);
      if (rawBoxes.length === 0) {
        throw new Error("ocr-no-text");
      }

      if (signal.aborted) {
        throw new DOMException("Local translation cancelled", "AbortError");
      }

      const tessLangs = mapLanguage(metadata.sourceLanguage);

      // Create worker using the wrapper with remaining time
      try {
        await runWithAbortAndTimeout(
          async () => {
            const w = await Tesseract.createWorker(tessLangs, 1, {
              workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
              corePath: chrome.runtime.getURL('tesseract/'),
              langPath: chrome.runtime.getURL('tesseract/lang'),
              workerBlobURL: false,
              gzip: false,
            });
            workerRef.worker = w;
            return w;
          },
          signal,
          getRemainingTime(),
          workerRef
        );
      } catch (err: any) {
        if (err.name === "AbortError" || err.message === "ocr-timeout") {
          throw err;
        }
        throw new Error("ocr-unavailable");
      }

      if (signal.aborted) {
        throw new DOMException("Local translation cancelled", "AbortError");
      }

      const recognizedRegions: TempRegion[] = [];

      for (const box of rawBoxes) {
        if (signal.aborted) {
          throw new DOMException("Local translation cancelled", "AbortError");
        }

        const cropCanvas = new OffscreenCanvas(box.width, box.height);
        const cropCtx = cropCanvas.getContext("2d");
        if (!cropCtx) {
          throw new Error("ocr-unavailable");
        }

        cropCtx.drawImage(
          imageBitmap,
          box.x,
          box.y,
          box.width,
          box.height,
          0,
          0,
          box.width,
          box.height
        );

        const cropBlob = await cropCanvas.convertToBlob({ type: "image/png" });
        if (signal.aborted) {
          throw new DOMException("Local translation cancelled", "AbortError");
        }

        let ocrResult: any;
        try {
          ocrResult = await runWithAbortAndTimeout(
            async () => {
              return await workerRef.worker.recognize(cropBlob);
            },
            signal,
            getRemainingTime(),
            workerRef
          );
        } catch (err: any) {
          if (err.name === "AbortError" || err.message === "ocr-timeout") {
            throw err;
          }
          throw new Error("ocr-unavailable");
        }
        
        if (signal.aborted) {
          throw new DOMException("Local translation cancelled", "AbortError");
        }

        const text = ocrResult.data.text.trim();
        if (text) {
          recognizedRegions.push({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            text,
          });
        }
      }

      if (recognizedRegions.length === 0) {
        throw new Error("ocr-no-text");
      }

      if (signal.aborted) {
        throw new DOMException("Local translation cancelled", "AbortError");
      }

      const grouped = groupTextRegions(
        recognizedRegions,
        imageBitmap.width,
        imageBitmap.height
      );

      const bubbles: TranslationBubble[] = grouped.map((g, index) => {
        const bx = Math.max(0, Math.min(1, g.x / imageBitmap!.width));
        const by = Math.max(0, Math.min(1, g.y / imageBitmap!.height));
        const bw = Math.max(0, Math.min(1 - bx, g.width / imageBitmap!.width));
        const bh = Math.max(0, Math.min(1 - by, g.height / imageBitmap!.height));

        return {
          id: `${metadata.pageId}-local-${index + 1}`,
          bounds: {
            x: bx,
            y: by,
            width: bw,
            height: bh,
          },
          originalText: g.text,
          translatedText: g.text,
        };
      });

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
    } finally {
      if (imageBitmap && typeof imageBitmap.close === "function") {
        imageBitmap.close();
      }
      if (workerRef.worker) {
        await workerRef.worker.terminate().catch(() => {});
      }
    }
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

export function resetOffscreenLifecycleForTesting() {
  activeScansCount = 0;
  isClosing = false;
  offscreenClosePromise = null;
  offscreenCreationPromise = null;
}
