import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "@/lib/storage";

describe("reader settings", () => {
  let storageGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageGet = vi.fn();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: storageGet,
          set: vi.fn(),
        },
      },
    });
  });

  it("keeps local AI inactive for existing settings", async () => {
    storageGet.mockResolvedValue({
      "mangalens-settings": {
        sourceLanguage: "ko",
        targetLanguage: "en",
        translationsVisible: true,
      },
    });

    await expect(getSettings()).resolves.toMatchObject({
      sourceLanguage: "ko",
      targetLanguage: "en",
      translationsVisible: true,
      localAiEnabled: false,
    });
  });

  it("restores an explicit local AI opt-in", async () => {
    storageGet.mockResolvedValue({
      "mangalens-settings": {
        sourceLanguage: "auto",
        targetLanguage: "it",
        translationsVisible: false,
        localAiEnabled: true,
      },
    });

    await expect(getSettings()).resolves.toMatchObject({ localAiEnabled: true });
  });
});
