import { describe, expect, it } from "vitest";
import { responsiveBubbleFontSize } from "@/lib/bubble-layout";

describe("responsive bubble font sizing", () => {
  it("reduces font size for denser text while keeping safe limits", () => {
    const short = responsiveBubbleFontSize(240, 100, "Short", "horizontal");
    const long = responsiveBubbleFontSize(
      240,
      100,
      "A much longer translated sentence that needs more room",
      "horizontal"
    );
    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThanOrEqual(9);
    expect(short).toBeLessThanOrEqual(22);
  });

  it("uses width as the cross-axis limit for vertical text", () => {
    expect(responsiveBubbleFontSize(30, 300, "縦書き", "vertical")).toBe(12.6);
  });

  it("returns the safe minimum for invalid or empty geometry", () => {
    expect(responsiveBubbleFontSize(0, 100, "text", "horizontal")).toBe(9);
    expect(responsiveBubbleFontSize(Number.NaN, 100, "text", "horizontal"))
      .toBe(9);
  });
});
