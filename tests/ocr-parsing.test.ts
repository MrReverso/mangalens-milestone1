import { describe, expect, it } from "vitest";
import {
  normalizeOcrText,
  reconstructParagraphText,
} from "@/dev/backend/ocr/ocr-text";
import { normalizeParagraphBounds } from "@/dev/backend/ocr/ocr-geometry";
import { ocrRegionsToBubbles } from "@/dev/backend/ocr/ocr-to-bubbles";
import {
  validateGoogleVisionResponse,
  type GoogleParagraph,
  type GoogleVertex,
} from "@/dev/backend/ocr/google-vision-response-validator";

function paragraph(
  symbols: Array<{ text: string; breakType?: string }> = [{ text: "文" }],
  vertices: GoogleVertex[] = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 20 },
    { x: 0, y: 20 },
  ]
): GoogleParagraph {
  return { vertices, words: [{ symbols }] };
}

describe("OCR paragraph text", () => {
  it("reconstructs paragraph symbols in provider order", () => {
    expect(reconstructParagraphText(paragraph([
      { text: "読" }, { text: "め" }, { text: "る" },
    ]))).toBe("読める");
  });

  it.each([
    ["SPACE", "A B"],
    ["SURE_SPACE", "A B"],
    ["EOL_SURE_SPACE", "A\nB"],
    ["LINE_BREAK", "A\nB"],
    ["HYPHEN", "A-B"],
  ])("handles %s detected breaks", (breakType, expected) => {
    expect(reconstructParagraphText(paragraph([
      { text: "A", breakType }, { text: "B" },
    ]))).toBe(expected);
  });

  it.each(["日本語", "한국어", "中文"])(
    "preserves %s Unicode text",
    (text) => expect(normalizeOcrText(text)).toBe(text)
  );

  it("normalizes spaces and line breaks and removes empty paragraphs", () => {
    expect(normalizeOcrText("  one   two \n\n\n three  "))
      .toBe("one two\n\nthree");
    expect(normalizeOcrText(" \n ")).toBeNull();
  });

  it("rejects control characters and over-limit regions", () => {
    expect(() => normalizeOcrText("unsafe\u0000text"))
      .toThrow("ocr-invalid-response");
    expect(() => normalizeOcrText("a".repeat(1_001)))
      .toThrow("ocr-invalid-response");
  });

  it("counts Unicode characters without splitting surrogate pairs", () => {
    expect(normalizeOcrText("😀".repeat(1_000))).toBe("😀".repeat(1_000));
    expect(() => normalizeOcrText("😀".repeat(1_001)))
      .toThrow("ocr-invalid-response");
  });
});

describe("OCR geometry", () => {
  it("treats omitted zero x and y coordinates as zero", () => {
    expect(normalizeParagraphBounds([
      {},
      { x: 50 },
      { x: 50, y: 20 },
      { y: 20 },
    ], 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.2,
    });
  });

  it("converts a rotated quadrilateral to an axis-aligned normalized rect", () => {
    expect(normalizeParagraphBounds([
      { x: 20, y: 10 },
      { x: 80, y: 20 },
      { x: 70, y: 60 },
      { x: 10, y: 50 },
    ], 100, 100)).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.7,
      height: 0.5,
    });
  });

  it("rejects invalid count, negative, non-finite, out-of-image and zero area", () => {
    expect(() => normalizeParagraphBounds([{ x: 0, y: 0 }], 100, 100))
      .toThrow("ocr-invalid-response");
    expect(() => normalizeParagraphBounds([
      { x: -2, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ], 100, 100)).toThrow("ocr-invalid-response");
    expect(() => normalizeParagraphBounds([
      { x: Number.NaN, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ], 100, 100)).toThrow("ocr-invalid-response");
    expect(() => normalizeParagraphBounds([
      { x: 0, y: 0 }, { x: 101, y: 0 },
      { x: 101, y: 10 }, { x: 0, y: 10 },
    ], 100, 100)).toThrow("ocr-invalid-response");
    expect(() => normalizeParagraphBounds([
      { x: 1, y: 1 }, { x: 1, y: 1 },
      { x: 1, y: 1 }, { x: 1, y: 1 },
    ], 100, 100)).toThrow("ocr-invalid-response");
  });

  it("clamps only tiny floating-point overflow", () => {
    expect(normalizeParagraphBounds([
      { x: -0.0001, y: 0 },
      { x: 100.0001, y: 0 },
      { x: 100.0001, y: 50 },
      { x: -0.0001, y: 50 },
    ], 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.5,
    });
  });
});

describe("Google response validation and bubble mapping", () => {
  it("extracts paragraph order and rejects multiple responses", () => {
    const response = {
      responses: [{
        fullTextAnnotation: {
          pages: [{ blocks: [{ paragraphs: [
            rawParagraph("first"),
            rawParagraph("second"),
          ] }] }],
        },
      }],
    };
    const parsed = validateGoogleVisionResponse(response);
    expect(parsed.map(reconstructParagraphText)).toEqual(["first", "second"]);
    expect(() => validateGoogleVisionResponse({
      responses: [response.responses[0], response.responses[0]],
    })).toThrow("ocr-invalid-response");
  });

  it("rejects malformed vertices, symbols, and provider-level errors", () => {
    expect(() => validateGoogleVisionResponse({
      responses: [{ error: { code: 7 } }],
    })).toThrow("ocr-invalid-response");
    expect(() => validateGoogleVisionResponse({
      responses: [{
        fullTextAnnotation: {
          pages: [{ blocks: [{ paragraphs: [{
            boundingBox: { vertices: [null, {}, {}, {}] },
            words: [],
          }] }] }],
        },
      }],
    })).toThrow("ocr-invalid-response");
    expect(() => validateGoogleVisionResponse({
      responses: [{
        fullTextAnnotation: {
          pages: [{ blocks: [{ paragraphs: [{
            boundingBox: { vertices: [{}, {}, {}, {}] },
            words: [{ symbols: [{ text: 42 }] }],
          }] }] }],
        },
      }],
    })).toThrow("ocr-invalid-response");
  });

  it("ignores unknown string detectedBreak values and accepts missing breaks", () => {
    const response = (symbol: unknown) => ({
      responses: [{
        fullTextAnnotation: {
          pages: [{ blocks: [{ paragraphs: [{
            boundingBox: {
              vertices: [{}, { x: 20 }, { x: 20, y: 20 }, { y: 20 }],
            },
            words: [{ symbols: [symbol, { text: "B" }] }],
          }] }] }],
        },
      }],
    });
    const unknown = validateGoogleVisionResponse(response({
      text: "A",
      property: { detectedBreak: { type: "FUTURE_BREAK" } },
    }));
    expect(reconstructParagraphText(unknown[0])).toBe("AB");
    const missing = validateGoogleVisionResponse(response({ text: "A" }));
    expect(reconstructParagraphText(missing[0])).toBe("AB");
  });

  it("rejects non-string and malformed detectedBreak structures", () => {
    const response = (property: unknown) => ({
      responses: [{
        fullTextAnnotation: {
          pages: [{ blocks: [{ paragraphs: [{
            boundingBox: {
              vertices: [{}, { x: 20 }, { x: 20, y: 20 }, { y: 20 }],
            },
            words: [{ symbols: [{ text: "A", property }] }],
          }] }] }],
        },
      }],
    });
    expect(() => validateGoogleVisionResponse(response({
      detectedBreak: { type: 42 },
    }))).toThrow("ocr-invalid-response");
    expect(() => validateGoogleVisionResponse(response({
      detectedBreak: "LINE_BREAK",
    }))).toThrow("ocr-invalid-response");
    expect(() => validateGoogleVisionResponse(response("not-an-object")))
      .toThrow("ocr-invalid-response");
  });

  it("maps regions to unique request-local bubbles without raw Google fields", () => {
    const bubbles = ocrRegionsToBubbles("request-1", [
      { text: "一", bounds: { x: 0, y: 0, width: 0.2, height: 0.1 } },
      { text: "二", bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 } },
    ]);
    expect(bubbles.map((bubble) => bubble.id)).toEqual([
      "request-1-ocr-1",
      "request-1-ocr-2",
    ]);
    expect(bubbles[0].originalText).toBe("一");
    expect(bubbles[0].translatedText).toBe("一");
    expect(JSON.stringify(bubbles)).not.toContain("symbols");
    expect(JSON.stringify(bubbles)).not.toContain("boundingBox");
  });
});

function rawParagraph(text: string): unknown {
  return {
    boundingBox: {
      vertices: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    },
    words: [{ symbols: [...text].map((symbol) => ({ text: symbol })) }],
  };
}
