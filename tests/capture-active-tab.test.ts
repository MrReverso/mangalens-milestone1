import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureCoordinator,
  createBackgroundCaptureMessageHandler,
  type CaptureCoordinatorDependencies,
} from "@/lib/capture/capture-coordinator";
import type {
  CaptureDescriptor,
  CapturedImage,
  CaptureMetadata,
} from "@/types/capture";

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => resolvePromise?.(value),
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

const descriptor: CaptureDescriptor = {
  captureToken: "active-token",
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

function dependencies(
  isTabActive: CaptureCoordinatorDependencies["isTabActive"]
): CaptureCoordinatorDependencies {
  return {
    isTabActive,
    sendToTab: vi.fn(async (_tabId, message) =>
      message.type === "PREPARE_VISIBLE_PAGE_CAPTURE"
        ? { success: true, descriptor }
        : { success: true }),
    captureVisibleTab: vi.fn(async () => "data:image/png;base64,AA=="),
    cropper: { crop: vi.fn(async () => captured) },
    createToken: () => "active-token",
    timeoutMs: 20,
    restoreTimeoutMs: 10,
    retirementTimeoutMs: 50,
  };
}

describe("CaptureCoordinator active-tab revalidation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops before screenshot when the tab changes after PREPARE", async () => {
    const isTabActive = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const deps = dependencies(isTabActive);
    const response = await new CaptureCoordinator(deps).capture(request);
    expect(response).toEqual({
      success: false,
      error: { code: "active-tab-changed" },
    });
    expect(deps.captureVisibleTab).not.toHaveBeenCalled();
    expect(deps.cropper.crop).not.toHaveBeenCalled();
    expect(deps.sendToTab).toHaveBeenLastCalledWith(7, {
      type: "RESTORE_AFTER_PAGE_CAPTURE",
      captureToken: "active-token",
    });
  });

  it("discards screenshot pixels when the tab changes during capture", async () => {
    const isTabActive = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const deps = dependencies(isTabActive);
    const response = await new CaptureCoordinator(deps).capture(request);
    expect(response).toEqual({
      success: false,
      error: { code: "active-tab-changed" },
    });
    expect(deps.captureVisibleTab).toHaveBeenCalledOnce();
    expect(deps.cropper.crop).not.toHaveBeenCalled();
    expect(deps.sendToTab).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ type: "RESTORE_AFTER_PAGE_CAPTURE" })
    );
  });

  it("captures and crops once when the tab stays active", async () => {
    const isTabActive = vi.fn(async () => true);
    const deps = dependencies(isTabActive);
    expect(await new CaptureCoordinator(deps).capture(request)).toEqual({
      success: true,
      metadata,
    });
    expect(isTabActive).toHaveBeenCalledTimes(3);
    expect(deps.captureVisibleTab).toHaveBeenCalledOnce();
    expect(deps.cropper.crop).toHaveBeenCalledOnce();
  });

  it("times out exactly once while the post-PREPARE check is pending", async () => {
    vi.useFakeTimers();
    const laterCheck = deferred<boolean>();
    const isTabActive = vi.fn()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => laterCheck.promise);
    const deps = dependencies(isTabActive);
    const coordinator = new CaptureCoordinator(deps);
    const handler = createBackgroundCaptureMessageHandler(coordinator);
    const sendResponse = vi.fn();
    handler(request, {} as chrome.runtime.MessageSender, sendResponse);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(20);
    await flushPromises();
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: "timeout" },
    });
    expect(deps.captureVisibleTab).not.toHaveBeenCalled();
    laterCheck.resolve(true);
    await flushPromises();
    expect(deps.captureVisibleTab).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledTimes(1);
  });

  it("times out during post-screenshot validation and never crops", async () => {
    vi.useFakeTimers();
    const postScreenshotCheck = deferred<boolean>();
    const isTabActive = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => postScreenshotCheck.promise);
    const deps = dependencies(isTabActive);
    const result = new CaptureCoordinator(deps).capture(request);
    await flushPromises();
    expect(deps.captureVisibleTab).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toEqual({
      success: false,
      error: { code: "timeout" },
    });
    postScreenshotCheck.resolve(true);
    await flushPromises();
    expect(deps.cropper.crop).not.toHaveBeenCalled();
  });
});
