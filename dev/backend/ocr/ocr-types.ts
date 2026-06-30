import type { SourceLanguage } from "../../../types/extension";
import type { Buffer } from "node:buffer";

export interface OcrInput {
  readonly image: Buffer;
  readonly mimeType: "image/png";
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly sourceLanguage: SourceLanguage;
}

export interface OcrBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OcrRegion {
  readonly text: string;
  readonly bounds: OcrBounds;
}

export interface OcrResult {
  readonly regions: readonly OcrRegion[];
}
