import { describe, expect, it } from "vitest";
import { captureErrorMessage } from "@/lib/capture/capture-status";

describe("capture popup status", () => {
  it("maps active-tab-changed to a friendly retry instruction", () => {
    expect(captureErrorMessage("active-tab-changed")).toBe(
      "The active tab changed. Return to the manga tab and try again"
    );
  });
});
