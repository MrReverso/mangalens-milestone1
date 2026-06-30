import { OcrFailure } from "./ocr-errors";

export interface GoogleVertex {
  readonly x?: number;
  readonly y?: number;
}

export interface GoogleSymbol {
  readonly text: string;
  readonly breakType?: string;
}

export interface GoogleWord {
  readonly symbols: readonly GoogleSymbol[];
}

export interface GoogleParagraph {
  readonly vertices: readonly GoogleVertex[];
  readonly words: readonly GoogleWord[];
}

const BREAK_TYPES = new Set([
  "SPACE",
  "SURE_SPACE",
  "EOL_SURE_SPACE",
  "LINE_BREAK",
  "HYPHEN",
]);

export function validateGoogleVisionResponse(
  value: unknown
): readonly GoogleParagraph[] {
  if (!isRecord(value) || !Array.isArray(value.responses) ||
      value.responses.length !== 1) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const imageResponse = value.responses[0];
  if (!isRecord(imageResponse) || "error" in imageResponse) {
    throw new OcrFailure("ocr-invalid-response");
  }
  if (!("fullTextAnnotation" in imageResponse)) return [];
  if (!isRecord(imageResponse.fullTextAnnotation) ||
      !Array.isArray(imageResponse.fullTextAnnotation.pages)) {
    throw new OcrFailure("ocr-invalid-response");
  }

  const paragraphs: GoogleParagraph[] = [];
  for (const page of imageResponse.fullTextAnnotation.pages) {
    if (!isRecord(page) || !Array.isArray(page.blocks)) {
      throw new OcrFailure("ocr-invalid-response");
    }
    for (const block of page.blocks) {
      if (!isRecord(block) || !Array.isArray(block.paragraphs)) {
        throw new OcrFailure("ocr-invalid-response");
      }
      for (const paragraph of block.paragraphs) {
        paragraphs.push(validateParagraph(paragraph));
      }
    }
  }
  return paragraphs;
}

function validateParagraph(value: unknown): GoogleParagraph {
  if (!isRecord(value) || !isRecord(value.boundingBox) ||
      !Array.isArray(value.boundingBox.vertices) ||
      value.boundingBox.vertices.length !== 4 ||
      !Array.isArray(value.words)) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const vertices = value.boundingBox.vertices.map(validateVertex);
  const words = value.words.map(validateWord);
  return { vertices, words };
}

function validateVertex(value: unknown): GoogleVertex {
  if (!isRecord(value)) throw new OcrFailure("ocr-invalid-response");
  const x = value.x;
  const y = value.y;
  if (x !== undefined && !isFiniteNumber(x)) {
    throw new OcrFailure("ocr-invalid-response");
  }
  if (y !== undefined && !isFiniteNumber(y)) {
    throw new OcrFailure("ocr-invalid-response");
  }
  return {
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
  };
}

function validateWord(value: unknown): GoogleWord {
  if (!isRecord(value) || !Array.isArray(value.symbols)) {
    throw new OcrFailure("ocr-invalid-response");
  }
  return { symbols: value.symbols.map(validateSymbol) };
}

function validateSymbol(value: unknown): GoogleSymbol {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw new OcrFailure("ocr-invalid-response");
  }
  let breakType: string | undefined;
  if ("property" in value) {
    if (!isRecord(value.property)) {
      throw new OcrFailure("ocr-invalid-response");
    }
    if ("detectedBreak" in value.property) {
      if (!isRecord(value.property.detectedBreak) ||
          typeof value.property.detectedBreak.type !== "string" ||
          !BREAK_TYPES.has(value.property.detectedBreak.type)) {
        throw new OcrFailure("ocr-invalid-response");
      }
      breakType = value.property.detectedBreak.type;
    }
  }
  return { text: value.text, ...(breakType ? { breakType } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
