import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TranslationCoordinator,
  createBackgroundTranslationMessageHandler,
  type TranslationCoordinatorDependencies,
} from "@/lib/translation/translation-coordinator";
import { CaptureFailure } from "@/lib/capture/capture-errors";
import type { CapturedImage } from "@/types/capture";
import type { TranslationApiRequestMetadata } from "@/types/translation-api";

const captured: CapturedImage = {
  blob: new Blob(["pixels"], { type: "image/png" }),
  metadata: {
    pageId: "page-2",
    pageNumber: 2,
    method: "visible-tab-screenshot-crop",
    mimeType: "image/png",
    pixelWidth: 800,
    pixelHeight: 1200,
    byteLength: 6,
    sha256: "a".repeat(64),
  },
};
const request = {
  type: "TRANSLATE_VISIBLE_PAGE_LOCAL" as const,
  tabId: 7,
  windowId: 3,
  sourceLanguage: "auto" as const,
  targetLanguage: "en" as const,
};
const bubbles = [{
  id: "bubble-1",
  bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
  originalText: "Source",
  translatedText: "Demo",
}];

function dependencies(
  overrides: Partial<TranslationCoordinatorDependencies> = {}
): TranslationCoordinatorDependencies {
  return {
    captureImage: vi.fn(async () => captured),
    service: {
      translate: vi.fn(async (input) => ({
        contractVersion: 1,
        requestId: input.metadata.requestId,
        pageId: input.metadata.pageId,
        bubbles,
      })),
    },
    sendToTab: vi.fn(async () => ({
      success: true,
      pageId: "page-2",
      bubbleCount: 1,
    })),
    createRequestId: () => "request-1",
    reportStage: vi.fn(),
    timeoutMs: 100,
    retirementTimeoutMs: 50,
    ...overrides,
  };
}

describe("TranslationCoordinator", () => {
  afterEach(() => vi.useRealTimers());

  it("runs capture, service, validation, and content apply end to end", async () => {
    const deps = dependencies();
    const response = await new TranslationCoordinator(deps).translate(request);
    expect(response).toEqual({
      success: true,
      pageId: "page-2",
      pageNumber: 2,
      bubbleCount: 1,
      localDemo: true,
    });
    expect(deps.captureImage).toHaveBeenCalledTimes(1);
    expect(deps.sendToTab).toHaveBeenCalledWith(7, expect.objectContaining({
      type: "APPLY_TRANSLATION_RESULT",
      requestId: "request-1",
      pageId: "page-2",
    }));
    expect(deps.reportStage).toHaveBeenCalledTimes(3);
  });

  it("builds matching validated request metadata", async () => {
    let seen: TranslationApiRequestMetadata | null = null;
    const deps = dependencies({
      service: {
        translate: vi.fn(async (input) => {
          seen = input.metadata;
          return {
            contractVersion: 1,
            requestId: input.metadata.requestId,
            pageId: input.metadata.pageId,
            bubbles,
          };
        }),
      },
    });
    await new TranslationCoordinator(deps).translate(request);
    expect(seen).toMatchObject({
      requestId: "request-1",
      pageId: captured.metadata.pageId,
      pageNumber: captured.metadata.pageNumber,
      capture: captured.metadata,
    });
  });

  it("rejects mismatched request and page IDs", async () => {
    for (const mismatch of ["request", "page"] as const) {
      const deps = dependencies({
        service: {
          translate: vi.fn(async () => ({
            contractVersion: 1,
            requestId: mismatch === "request" ? "wrong" : "request-1",
            pageId: mismatch === "page" ? "wrong" : "page-2",
            bubbles,
          })),
        },
      });
      expect(await new TranslationCoordinator(deps).translate(request)).toEqual({
        success: false,
        error: { code: "invalid-translation-response" },
      });
      expect(deps.sendToTab).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid service output", async () => {
    const deps = dependencies({
      service: { translate: vi.fn(async () => ({
        contractVersion: 1,
        requestId: "request-1",
        pageId: "page-2",
        bubbles: [bubbles[0], bubbles[0]],
      })) },
    });
    expect(await new TranslationCoordinator(deps).translate(request)).toEqual({
      success: false,
      error: { code: "invalid-translation-response" },
    });
  });

  it("releases its lock after capture, service, apply failure and success", async () => {
    const failures: Partial<TranslationCoordinatorDependencies>[] = [
      { captureImage: vi.fn(async () => { throw new CaptureFailure("crop-failed"); }) },
      { service: { translate: vi.fn(async () => { throw new Error("private"); }) } },
      { sendToTab: vi.fn(async () => ({ success: false, error: { code: "apply-failed" } })) },
    ];
    for (const failure of failures) {
      const deps = dependencies(failure);
      const coordinator = new TranslationCoordinator(deps);
      expect((await coordinator.translate(request)).success).toBe(false);
      const retry = await coordinator.translate(request);
      expect(retry).not.toEqual({
        success: false,
        error: { code: "translation-in-progress" },
      });
    }
    const coordinator = new TranslationCoordinator(dependencies());
    expect((await coordinator.translate(request)).success).toBe(true);
    expect((await coordinator.translate(request)).success).toBe(true);
  });

  it("enforces one operation per tab while allowing another tab", async () => {
    let resolveCapture!: (value: CapturedImage) => void;
    const pending = new Promise<CapturedImage>((resolve) => {
      resolveCapture = resolve;
    });
    const deps = dependencies({ captureImage: vi.fn(() => pending) });
    const coordinator = new TranslationCoordinator(deps);
    const first = coordinator.translate(request);
    await Promise.resolve();
    expect(await coordinator.translate(request)).toEqual({
      success: false,
      error: { code: "translation-in-progress" },
    });
    const other = coordinator.translate({ ...request, tabId: 8 });
    resolveCapture(captured);
    expect((await first).success).toBe(true);
    expect((await other).success).toBe(true);
  });

  it("rejects translation while diagnostic capture owns the tab", async () => {
    const deps = dependencies({ isCaptureActive: () => true });
    expect(await new TranslationCoordinator(deps).translate(request)).toEqual({
      success: false,
      error: { code: "translation-in-progress" },
    });
    expect(deps.captureImage).not.toHaveBeenCalled();
  });

  it("times out once, aborts service, and never applies a late result", async () => {
    vi.useFakeTimers();
    const observed: { signal?: AbortSignal } = {};
    const deps = dependencies({
      service: {
        translate: vi.fn((_input, operationSignal) => {
          observed.signal = operationSignal;
          return new Promise(() => undefined);
        }),
      },
      timeoutMs: 20,
    });
    const promise = new TranslationCoordinator(deps).translate(request);
    await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual({
      success: false,
      error: { code: "timeout" },
    });
    expect(observed.signal?.aborted).toBe(true);
    expect(deps.sendToTab).not.toHaveBeenCalled();
  });

  it("does not capture after timing out during a progress boundary", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const deps = dependencies({
      reportStage: vi.fn(() => new Promise<void>((resolve) => {
        release = resolve;
      })),
      timeoutMs: 20,
    });
    const promise = new TranslationCoordinator(deps).translate(request);
    await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual({
      success: false,
      error: { code: "timeout" },
    });
    release();
    await Promise.resolve();
    expect(deps.captureImage).not.toHaveBeenCalled();
  });

  it("returns safe popup data without image bytes or hashes", async () => {
    const response = await new TranslationCoordinator(dependencies())
      .translate(request);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("pixels");
    expect(serialized).not.toContain("sha256");
    expect(serialized).not.toContain("request-1");
  });

  it("background handler ignores unrelated content commands", () => {
    const handler = createBackgroundTranslationMessageHandler(
      new TranslationCoordinator(dependencies())
    );
    const sendResponse = vi.fn();
    expect(handler(
      { type: "SCAN_PAGE" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
