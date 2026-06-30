import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureCoordinator,
  createBackgroundCaptureMessageHandler,
  type CaptureCoordinatorDependencies,
} from "@/lib/capture/capture-coordinator";
import { CaptureFailure } from "@/lib/capture/capture-errors";
import type {
  CaptureDescriptor,
  CapturedImage,
  CaptureMetadata,
} from "@/types/capture";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (reason) => rejectPromise?.(reason),
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index++) {
    await Promise.resolve();
  }
}

const descriptor: CaptureDescriptor = {
  captureToken: "token-1",
  pageId: "page-1",
  pageNumber: 1,
  imageRect: { top: 10, left: 20, width: 400, height: 300 },
  viewportWidth: 1000,
  viewportHeight: 800,
};

const metadata: CaptureMetadata = {
  pageId: "page-1",
  pageNumber: 1,
  method: "visible-tab-screenshot-crop",
  mimeType: "image/png",
  pixelWidth: 400,
  pixelHeight: 300,
  byteLength: 100,
  sha256: "a".repeat(64),
};

const captured: CapturedImage = {
  blob: new Blob(["png"], { type: "image/png" }),
  metadata,
};

const request = {
  type: "CAPTURE_FIRST_VISIBLE_PAGE" as const,
  tabId: 7,
  windowId: 3,
};

function baseDependencies(
  overrides: Partial<CaptureCoordinatorDependencies> = {}
): CaptureCoordinatorDependencies {
  return {
    isTabActive: vi.fn(async () => true),
    sendToTab: vi.fn(async (_tabId, message) =>
      message.type === "PREPARE_VISIBLE_PAGE_CAPTURE"
        ? { success: true, descriptor }
        : { success: true }),
    captureVisibleTab: vi.fn(async () => "data:image/png;base64,AA=="),
    cropper: { crop: vi.fn(async () => captured) },
    createToken: () => "token-1",
    timeoutMs: 20,
    restoreTimeoutMs: 10,
    retirementTimeoutMs: 50,
    ...overrides,
  };
}

describe("CaptureCoordinator cancellation and retirement", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not capture after timing out while PREPARE is pending", async () => {
    vi.useFakeTimers();
    const prepare = deferred<unknown>();
    const deps = baseDependencies({
      sendToTab: vi.fn((_tabId, message) =>
        message.type === "PREPARE_VISIBLE_PAGE_CAPTURE"
          ? prepare.promise
          : Promise.resolve({ success: true })),
    });
    const result = new CaptureCoordinator(deps).capture(request);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toEqual({
      success: false,
      error: { code: "timeout" },
    });
    prepare.resolve({ success: true, descriptor });
    await flushPromises();
    expect(deps.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("restores again when PREPARE succeeds after timeout", async () => {
    vi.useFakeTimers();
    const prepare = deferred<unknown>();
    const sendToTab = vi.fn((_tabId: number, message) =>
      message.type === "PREPARE_VISIBLE_PAGE_CAPTURE"
        ? prepare.promise
        : Promise.resolve({ success: true }));
    const coordinator = new CaptureCoordinator(baseDependencies({ sendToTab }));
    const result = coordinator.capture(request);
    await vi.advanceTimersByTimeAsync(20);
    await result;
    expect(sendToTab.mock.calls.filter(([, message]) =>
      message.type === "RESTORE_AFTER_PAGE_CAPTURE")).toHaveLength(1);

    prepare.resolve({ success: true, descriptor });
    await flushPromises();
    expect(sendToTab.mock.calls.filter(([, message]) =>
      message.type === "RESTORE_AFTER_PAGE_CAPTURE")).toHaveLength(2);
    expect(sendToTab).toHaveBeenLastCalledWith(7, {
      type: "RESTORE_AFTER_PAGE_CAPTURE",
      captureToken: "token-1",
    });
  });

  it("does not crop after timing out while screenshot capture is pending", async () => {
    vi.useFakeTimers();
    const screenshot = deferred<string>();
    const deps = baseDependencies({
      captureVisibleTab: vi.fn(() => screenshot.promise),
    });
    const result = new CaptureCoordinator(deps).capture(request);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20);
    expect((await result).success).toBe(false);
    screenshot.resolve("data:image/png;base64,AA==");
    await flushPromises();
    expect(deps.cropper.crop).not.toHaveBeenCalled();
  });

  it("discards a late crop result and aborts the cropper signal", async () => {
    vi.useFakeTimers();
    const crop = deferred<CapturedImage>();
    let cropSignal: AbortSignal | undefined;
    const deps = baseDependencies({
      cropper: {
        crop: vi.fn((_dataUrl, _captureDescriptor, signal) => {
          cropSignal = signal;
          return crop.promise;
        }),
      },
    });
    const result = new CaptureCoordinator(deps).capture(request);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toEqual({
      success: false,
      error: { code: "timeout" },
    });
    expect(cropSignal?.aborted).toBe(true);
    crop.resolve(captured);
    await flushPromises();
    expect(cropSignal?.aborted).toBe(true);
  });

  it("sends exactly one popup response when crop completes after timeout", async () => {
    vi.useFakeTimers();
    const crop = deferred<CapturedImage>();
    const coordinator = new CaptureCoordinator(baseDependencies({
      cropper: { crop: vi.fn(() => crop.promise) },
    }));
    const handler = createBackgroundCaptureMessageHandler(coordinator);
    const sendResponse = vi.fn();
    expect(handler(
      request,
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(true);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20);
    await flushPromises();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "timeout" },
    });
    crop.resolve(captured);
    await flushPromises();
    expect(sendResponse).toHaveBeenCalledTimes(1);
  });

  it("handles a late rejection without an unhandled second result", async () => {
    vi.useFakeTimers();
    const screenshot = deferred<string>();
    const coordinator = new CaptureCoordinator(baseDependencies({
      captureVisibleTab: vi.fn(() => screenshot.promise),
    }));
    const result = coordinator.capture(request);
    await vi.advanceTimersByTimeAsync(20);
    expect((await result).success).toBe(false);
    screenshot.reject(new Error("late browser rejection"));
    await flushPromises();
    expect(true).toBe(true);
  });

  it("rejects retry during retirement and releases after settlement", async () => {
    vi.useFakeTimers();
    const firstPrepare = deferred<unknown>();
    let prepareCalls = 0;
    const deps = baseDependencies({
      sendToTab: vi.fn((_tabId, message) => {
        if (message.type === "RESTORE_AFTER_PAGE_CAPTURE") {
          return Promise.resolve({ success: true });
        }
        prepareCalls++;
        return prepareCalls === 1
          ? firstPrepare.promise
          : Promise.resolve({ success: true, descriptor });
      }),
    });
    const coordinator = new CaptureCoordinator(deps);
    const first = coordinator.capture(request);
    await vi.advanceTimersByTimeAsync(20);
    await first;
    expect(await coordinator.capture(request)).toEqual({
      success: false,
      error: { code: "capture-in-progress" },
    });

    firstPrepare.resolve({ success: true, descriptor });
    await flushPromises();
    expect((await coordinator.capture(request)).success).toBe(true);
  });

  it("bounded retirement releases a permanently stuck operation", async () => {
    vi.useFakeTimers();
    const stuckPrepare = deferred<unknown>();
    let prepareCalls = 0;
    const deps = baseDependencies({
      sendToTab: vi.fn((_tabId, message) => {
        if (message.type === "RESTORE_AFTER_PAGE_CAPTURE") {
          return Promise.resolve({ success: true });
        }
        prepareCalls++;
        return prepareCalls === 1
          ? stuckPrepare.promise
          : Promise.resolve({ success: true, descriptor });
      }),
    });
    const coordinator = new CaptureCoordinator(deps);
    const first = coordinator.capture(request);
    await vi.advanceTimersByTimeAsync(20);
    await first;
    expect((await coordinator.capture(request)).success).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect((await coordinator.capture(request)).success).toBe(true);
  });

  it("bounds hung restoration without holding the response or lock forever", async () => {
    vi.useFakeTimers();
    const hungRestore = deferred<unknown>();
    let restoreCalls = 0;
    const deps = baseDependencies({
      sendToTab: vi.fn((_tabId, message) => {
        if (message.type === "PREPARE_VISIBLE_PAGE_CAPTURE") {
          return Promise.resolve({ success: true, descriptor });
        }
        restoreCalls++;
        return restoreCalls === 1
          ? hungRestore.promise
          : Promise.resolve({ success: true });
      }),
    });
    const coordinator = new CaptureCoordinator(deps);
    const first = coordinator.capture(request);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10);
    expect((await first).success).toBe(true);
    expect((await coordinator.capture(request)).success).toBe(true);
  });

  it("preserves the original crop failure when restoration rejects", async () => {
    const deps = baseDependencies({
      sendToTab: vi.fn(async (_tabId, message) => {
        if (message.type === "RESTORE_AFTER_PAGE_CAPTURE") {
          throw new Error("restore failed");
        }
        return { success: true, descriptor };
      }),
      cropper: {
        crop: vi.fn(async () => {
          throw new CaptureFailure("crop-failed");
        }),
      },
    });
    expect(await new CaptureCoordinator(deps).capture(request)).toEqual({
      success: false,
      error: { code: "crop-failed" },
    });
  });

  it("preserves the original error when restoration throws synchronously", async () => {
    const deps = baseDependencies({
      sendToTab: vi.fn((_tabId, message) => {
        if (message.type === "RESTORE_AFTER_PAGE_CAPTURE") {
          throw new Error("synchronous restore failure");
        }
        return Promise.resolve({ success: true, descriptor });
      }),
      captureVisibleTab: vi.fn(async () => {
        throw new Error("screenshot failed");
      }),
    });
    expect(await new CaptureCoordinator(deps).capture(request)).toEqual({
      success: false,
      error: { code: "screenshot-failed" },
    });
  });

  it("handler converts an unexpected rejection into one structured response", async () => {
    const coordinator = new CaptureCoordinator(baseDependencies());
    vi.spyOn(coordinator, "capture").mockRejectedValue(
      new Error("unexpected coordinator rejection")
    );
    const sendResponse = vi.fn();
    const handler = createBackgroundCaptureMessageHandler(coordinator);
    expect(handler(
      request,
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(true);
    await flushPromises();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "unexpected-error" },
    });
  });

  it("keeps old-token restoration isolated from a newer operation", async () => {
    vi.useFakeTimers();
    const firstPrepare = deferred<unknown>();
    const tokens = ["old-token", "new-token"];
    const restoreTokens: string[] = [];
    let prepareCalls = 0;
    const deps = baseDependencies({
      createToken: () => tokens.shift() ?? "fallback-token",
      sendToTab: vi.fn((_tabId, message) => {
        if (message.type === "RESTORE_AFTER_PAGE_CAPTURE") {
          restoreTokens.push(message.captureToken);
          return Promise.resolve({ success: true });
        }
        prepareCalls++;
        return prepareCalls === 1
          ? firstPrepare.promise
          : Promise.resolve({
            success: true,
            descriptor: { ...descriptor, captureToken: "new-token" },
          });
      }),
    });
    const coordinator = new CaptureCoordinator(deps);
    const first = coordinator.capture(request);
    await vi.advanceTimersByTimeAsync(20);
    await first;
    await vi.advanceTimersByTimeAsync(50);
    expect((await coordinator.capture(request)).success).toBe(true);
    firstPrepare.resolve({
      success: true,
      descriptor: { ...descriptor, captureToken: "old-token" },
    });
    await flushPromises();
    expect(restoreTokens).toContain("old-token");
    expect(restoreTokens).toContain("new-token");
    expect(restoreTokens.at(-1)).toBe("old-token");
  });
});
