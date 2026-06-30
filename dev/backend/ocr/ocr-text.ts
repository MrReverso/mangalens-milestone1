import { OcrFailure } from "./ocr-errors";
import type { GoogleParagraph } from "./google-vision-response-validator";

const MAX_REGION_CHARACTERS = 1_000;

const BREAK_TEXT: Readonly<Record<string, string>> = {
  SPACE: " ",
  SURE_SPACE: " ",
  EOL_SURE_SPACE: "\n",
  LINE_BREAK: "\n",
  HYPHEN: "-",
};

export function reconstructParagraphText(
  paragraph: GoogleParagraph
): string | null {
  let raw = "";
  for (const word of paragraph.words) {
    for (const symbol of word.symbols) {
      raw += symbol.text;
      if (symbol.breakType) raw += BREAK_TEXT[symbol.breakType] ?? "";
    }
  }
  return normalizeOcrText(raw);
}

export function normalizeOcrText(value: string): string | null {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new OcrFailure("ocr-invalid-response");
  }
  const normalized = value
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (!normalized) return null;
  if (Array.from(normalized).length > MAX_REGION_CHARACTERS) {
    throw new OcrFailure("ocr-invalid-response");
  }
  return normalized;
}
