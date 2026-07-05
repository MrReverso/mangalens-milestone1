import type { TranslationBubble } from "@/types/translation";

const MIN_FONT_SIZE_PX = 9;
const MAX_FONT_SIZE_PX = 22;

export function responsiveBubbleFontSize(
  width: number,
  height: number,
  text: string,
  orientation: TranslationBubble["orientation"]
): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width <= 0 || height <= 0) {
    return MIN_FONT_SIZE_PX;
  }
  const characterCount = Math.max(
    1,
    Array.from(text.replace(/\s/gu, "")).length
  );
  const areaSize = Math.sqrt((width * height) / characterCount) * 0.72;
  const crossAxisLimit = orientation === "vertical"
    ? width * 0.42
    : height * 0.42;
  return Number(Math.min(
    MAX_FONT_SIZE_PX,
    Math.max(MIN_FONT_SIZE_PX, Math.min(areaSize, crossAxisLimit))
  ).toFixed(2));
}
