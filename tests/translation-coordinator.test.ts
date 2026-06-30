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
  serviceMode: "local-demo" as const,
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
  const sequences = new Map<number, number>();
  const defaultService = {
    translate: vi.fn(async (input) => ({
      contractVersion: 1,
      requestId: input.metadata.requestId,
      pageId: input.metadata.pageId,
      bubbles,
    })),
  };
  return {
    captureImage: vi.fn(async () => captured),
    services: {
      "local-demo": defaultService,
      "development-api": defaultService,
    },
    sendToTab: vi.fn(async () => ({
      success: true,
      pageId: "page-2",
      bubbleCount: 1,
    })),
    nextOperationSequence: vi.fn(async (tabId: number) => {
      const nextSeq = (sequences.get(tabId) ?? 0) + 1;
      sequences.set(tabId, nextSeq);
      return nextSeq;
    }),
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
      demo: true,
      serviceMode: "local-demo",
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
    const mockService = {
      translate: vi.fn(async (input) => {
        seen = input.metadata;
        return {
          contractVersion: 1,
          requestId: input.metadata.requestId,
          pageId: input.metadata.pageId,
          bubbles,
        };
      }),
    };
    const deps = dependencies({
      services: {
        "local-demo": mockService,
        "development-api": mockService,
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
      const mockService = {
        translate: vi.fn(async () => ({
          contractVersion: 1,
          requestId: mismatch === "request" ? "wrong" : "request-1",
          pageId: mismatch === "page" ? "wrong" : "page-2",
          bubbles,
        })),
      };
      const deps = dependencies({
        services: {
          "local-demo": mockService,
          "development-api": mockService,
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
    const mockService = {
      translate: vi.fn(async () => ({
        contractVersion: 1,
        requestId: "request-1",
        pageId: "page-2",
        bubbles: [bubbles[0], bubbles[0]],
      })),
    };
    const deps = dependencies({
      services: {
        "local-demo": mockService,
        "development-api": mockService,
      },
    });
    expect(await new TranslationCoordinator(deps).translate(request)).toEqual({
      success: false,
      error: { code: "invalid-translation-response" },
    });
  });

  it("releases its lock after capture, service, apply failure and success", async () => {
    const failures: Partial<TranslationCoordinatorDependencies>[] = [
      { captureImage: vi.fn(async () => { throw new CaptureFailure("crop-failed"); }) },
      { services: { "local-demo": { translate: vi.fn(async () => { throw new Error("private"); }) }, "development-api": { translate: vi.fn(async () => { throw new Error("private"); }) } } },
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
    const testService = {
      translate: vi.fn((_input, operationSignal) => {
        observed.signal = operationSignal;
        return new Promise(() => undefined);
      }),
    };
    const deps = dependencies({
      services: {
        "local-demo": testService,
        "development-api": testService,
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

  it("background handler returns invalid-language for invalid languages in translation envelope", () => {
    const handler = createBackgroundTranslationMessageHandler(
      new TranslationCoordinator(dependencies())
    );
    const sendResponse = vi.fn();
    
    const result1 = handler(
      { type: "TRANSLATE_VISIBLE_PAGE_LOCAL", tabId: 1, windowId: 2, sourceLanguage: "invalid", targetLanguage: "en", serviceMode: "local-demo" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    expect(result1).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "invalid-language" },
    });

    sendResponse.mockClear();

    const result2 = handler(
      { type: "TRANSLATE_VISIBLE_PAGE_LOCAL", tabId: 1, windowId: 2, sourceLanguage: "auto", targetLanguage: "invalid", serviceMode: "local-demo" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    expect(result2).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "invalid-language" },
    });
  });

  it("background handler returns restricted-page for invalid tabId/windowId in translation envelope", () => {
    const handler = createBackgroundTranslationMessageHandler(
      new TranslationCoordinator(dependencies())
    );
    const sendResponse = vi.fn();

    const result1 = handler(
      { type: "TRANSLATE_VISIBLE_PAGE_LOCAL", tabId: 0, windowId: 2, sourceLanguage: "auto", targetLanguage: "en", serviceMode: "local-demo" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    expect(result1).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "restricted-page" },
    });

    sendResponse.mockClear();

    const result2 = handler(
      { type: "TRANSLATE_VISIBLE_PAGE_LOCAL", tabId: 1, windowId: -1, sourceLanguage: "auto", targetLanguage: "en", serviceMode: "local-demo" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    expect(result2).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "restricted-page" },
    });
  });

  it("background handler ignores completely unrelated messages", () => {
    const handler = createBackgroundTranslationMessageHandler(
      new TranslationCoordinator(dependencies())
    );
    const sendResponse = vi.fn();
    expect(handler(
      { type: "SOME_OTHER_EVENT" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();

    expect(handler(
      "not an object",
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("assigns monotonic sequences to operations starting in the same millisecond", async () => {
    vi.useFakeTimers();
    const systemTime = 1000000;
    vi.setSystemTime(systemTime);

    const seenMessages: any[] = [];
    const deps = dependencies({
      sendToTab: vi.fn(async (_tabId, message) => {
        seenMessages.push(message);
        return { success: true, pageId: "page-2", bubbleCount: 1 };
      }),
    });
    const coordinator = new TranslationCoordinator(deps);

    const promise1 = coordinator.translate(request);
    await vi.advanceTimersByTimeAsync(0);
    await promise1;

    const promise2 = coordinator.translate(request);
    await vi.advanceTimersByTimeAsync(0);
    await promise2;

    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[0].operationSequence).toBe(1);
    expect(seenMessages[1].operationSequence).toBe(2);
    expect(seenMessages[0].expiresAt).toBe(systemTime + deps.timeoutMs!);
    expect(seenMessages[1].expiresAt).toBe(systemTime + deps.timeoutMs!);
  });

  it("times out exactly once while sendToTab is pending, and never causes a second popup response", async () => {
    vi.useFakeTimers();
    let resolveSendToTab!: (value: any) => void;
    const sendToTabPromise = new Promise((resolve) => {
      resolveSendToTab = resolve;
    });

    const sendToTabSpy = vi.fn(() => sendToTabPromise);
    const deps = dependencies({
      sendToTab: sendToTabSpy,
      timeoutMs: 100,
    });
    const coordinator = new TranslationCoordinator(deps);
    
    const popupPromise = coordinator.translate(request);
    
    await vi.advanceTimersByTimeAsync(100);

    const result = await popupPromise;
    expect(result).toEqual({
      success: false,
      error: { code: "timeout" },
    });

    resolveSendToTab({
      success: true,
      pageId: "page-2",
      bubbleCount: 1,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(sendToTabSpy).toHaveBeenCalledTimes(1);
    const sentMessage = (sendToTabSpy.mock.calls[0] as any)[1];
    expect(sentMessage.type).toBe("APPLY_TRANSLATION_RESULT");
  });

  it("simulates service-worker restart: multiple coordinator instances using a shared fake sequence store preserve monotonic ordering", async () => {
    const sharedSequences = new Map<number, number>();
    const fakeStoreNext = async (tabId: number) => {
      const current = sharedSequences.get(tabId) ?? 0;
      const nextVal = current + 1;
      sharedSequences.set(tabId, nextVal);
      return nextVal;
    };

    const seenMessages: any[] = [];
    
    const deps1 = dependencies({
      nextOperationSequence: vi.fn(fakeStoreNext),
      sendToTab: vi.fn(async (_tabId, message) => {
        seenMessages.push(message);
        return { success: true, pageId: "page-2", bubbleCount: 1 };
      }),
    });
    const coordinator1 = new TranslationCoordinator(deps1);

    for (let i = 0; i < 5; i++) {
      const response = await coordinator1.translate(request);
      expect(response.success).toBe(true);
    }
    expect(seenMessages).toHaveLength(5);
    expect(seenMessages[4].operationSequence).toBe(5);

    const deps2 = dependencies({
      nextOperationSequence: vi.fn(fakeStoreNext),
      sendToTab: vi.fn(async (_tabId, message) => {
        seenMessages.push(message);
        return { success: true, pageId: "page-2", bubbleCount: 1 };
      }),
    });
    const coordinator2 = new TranslationCoordinator(deps2);

    const response = await coordinator2.translate(request);
    expect(response.success).toBe(true);
    expect(seenMessages).toHaveLength(6);
    expect(seenMessages[5].operationSequence).toBe(6);
  });

  it("rejects a second request for the same tab while sequence allocation is pending to prevent races", async () => {
    let resolveSequence!: (val: number) => void;
    const sequencePromise = new Promise<number>((resolve) => {
      resolveSequence = resolve;
    });

    const deps = dependencies({
      nextOperationSequence: () => sequencePromise,
    });
    const coordinator = new TranslationCoordinator(deps);

    const promise1 = coordinator.translate(request);

    const promise2 = coordinator.translate(request);
    expect(await promise2).toEqual({
      success: false,
      error: { code: "translation-in-progress" },
    });

    resolveSequence(1);
    const result1 = await promise1;
    expect(result1.success).toBe(true);
  });

  it("times out during sequence allocation, aborting the operation and never starting capture", async () => {
    vi.useFakeTimers();
    let resolveSequence!: (val: number) => void;
    const sequencePromise = new Promise<number>((resolve) => {
      resolveSequence = resolve;
    });

    const deps = dependencies({
      nextOperationSequence: () => sequencePromise,
      timeoutMs: 100,
    });
    const coordinator = new TranslationCoordinator(deps);

    const promise = coordinator.translate(request);

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toEqual({
      success: false,
      error: { code: "timeout" },
    });

    resolveSequence(1);

    await vi.advanceTimersByTimeAsync(0);

    expect(deps.captureImage).not.toHaveBeenCalled();
  });

  it("releases the lock immediately if storage sequence allocation fails", async () => {
    const deps = dependencies({
      nextOperationSequence: vi.fn().mockRejectedValue(new Error("Storage failed")),
    });
    const coordinator = new TranslationCoordinator(deps);

    const result = await coordinator.translate(request);
    expect(result).toEqual({
      success: false,
      error: { code: "unexpected-error" },
    });

    expect(coordinator.isActive(request.tabId)).toBe(false);
  });
});
