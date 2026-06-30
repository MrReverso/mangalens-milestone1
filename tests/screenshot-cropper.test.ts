import { describe, expect, it } from "vitest";
import { decodePngDataUrl } from "@/lib/capture/screenshot-cropper";

describe("screenshot data URL decoding", () => {
  it("decodes PNG bytes locally without fetch", async () => {
    const blob = decodePngDataUrl("data:image/png;base64,AQID");
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("rejects non-PNG and malformed data URLs", () => {
    expect(() => decodePngDataUrl("data:image/jpeg;base64,AQID"))
      .toThrow("screenshot-failed");
    expect(() => decodePngDataUrl("data:image/png;base64,%%%"))
      .toThrow("screenshot-failed");
  });
});
