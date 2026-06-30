import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureCoordinator,
  createBackgroundCaptureMessageHandler,
  type CaptureCoordinatorDependencies,
} from "@/lib/capture/capture-coordinator";
import { CaptureFailure } from "@/lib/capture/capture-errors";
import { sha256Hex } from "@/lib/capture/screenshot-cropper";
import type {
  CaptureDescriptor,
  CapturedImage,
  CaptureMetadata,
} from "@/types/capture";
import { isBackgroundCaptureResponse } from "@/types/capture";

const descriptor: CaptureDescriptor = {
  captureToken: "capture-token",
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
  pixelWidth: 800,
  pixelHeight: 600,
  byteLength: 1234,
  sha256: "a".repeat(64),
};

function dependencies(
  overrides: Partial<CaptureCoordinatorDependencies> = {}
): CaptureCoordinatorDependencies {
  return {
    isTabActive: vi.fn(async () => true),
    sendToTab: vi.fn(async (_tabId, message) =>
      message.type === "PREPARE_VISIBLE_PAGE_CAPTURE"
        ? { success: true, descriptor }
        : { success: true }),
    captureVisibleTab: vi.fn(async () => "data:image/png;base64,AA=="),
    cropper: {
      crop: vi.fn(async (): Promise<CapturedImage> => ({
        blob: new Blob(["pixels"], { type: "image/png" }),
        metadata,
      })),
    },
    createToken: () => "capture-token",
    timeoutMs: 100,
    ...overrides,
  };
}

const request = {
  type: "CAPTURE_FIRST_VISIBLE_PAGE" as const,
  tabId: 7,
  windowId: 3,
};

describe("CaptureCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns metadata only and restores overlays after success", async () => {
    const deps = dependencies();
    const response = await new CaptureCoordinator(deps).capture(request);
    expect(response).toEqual({ success: true, metadata });
    expect(JSON.stringify(response)).not.toContain("pixels");
    expect(deps.sendToTab).toHaveBeenLastCalledWith(7, {
      type: "RESTORE_AFTER_PAGE_CAPTURE",
      captureToken: "capture-token",
    });
  });

  it("restores overlays after screenshot failure", async () => {
    const deps = dependencies({
      captureVisibleTab: vi.fn(async () => {
        throw new Error("browser detail");
      }),
    });
    const response = await new CaptureCoordinator(deps).capture(request);
    expect(response).toEqual({
      success: false,
      error: { code: "screenshot-failed" },
    });
    expect(deps.sendToTab).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ type: "RESTORE_AFTER_PAGE_CAPTURE" })
    );
  });

  it("restores overlays after crop failure", async () => {
    const deps = dependencies({
      cropper: {
        crop: vi.fn(async () => {
          throw new CaptureFailure("crop-failed");
        }),
      },
    });
    const response = await new CaptureCoordinator(deps).capture(request);
    expect(response).toEqual({
      success: false,
      error: { code: "crop-failed" },
    });
    expect(deps.sendToTab).toHaveBeenCalledTimes(2);
  });

  it("attempts restoration after timeout", async () => {
    vi.useFakeTimers();
    const deps = dependencies({
      captureVisibleTab: vi.fn(() => new Promise<string>(() => undefined)),
      timeoutMs: 20,
    });
    const promise = new CaptureCoordinator(deps).capture(request);
    await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual({
      success: false,
      error: { code: "timeout" },
    });
    expect(deps.sendToTab).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ type: "RESTORE_AFTER_PAGE_CAPTURE" })
    );
  });

  it("rejects concurrent capture for the same tab", async () => {
    vi.useFakeTimers();
    const deps = dependencies({
      captureVisibleTab: vi.fn(() => new Promise<string>(() => undefined)),
      timeoutMs: 20,
    });
    const coordinator = new CaptureCoordinator(deps);
    const first = coordinator.capture(request);
    await Promise.resolve();
    expect(await coordinator.capture(request)).toEqual({
      success: false,
      error: { code: "capture-in-progress" },
    });
    await vi.advanceTimersByTimeAsync(20);
    await first;
  });

  it("releases its lock after failure and permits retry", async () => {
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("data:image/png;base64,AA==");
    const deps = dependencies({ captureVisibleTab: capture });
    const coordinator = new CaptureCoordinator(deps);
    expect((await coordinator.capture(request)).success).toBe(false);
    expect((await coordinator.capture(request)).success).toBe(true);
  });

  it("releases its lock after success and permits another capture", async () => {
    const deps = dependencies();
    const coordinator = new CaptureCoordinator(deps);
    expect((await coordinator.capture(request)).success).toBe(true);
    expect((await coordinator.capture(request)).success).toBe(true);
    expect(deps.captureVisibleTab).toHaveBeenCalledTimes(2);
  });

  it("returns accurate metadata without captured bytes", async () => {
    const response = await new CaptureCoordinator(dependencies()).capture(request);
    if (!response.success) throw new Error("Expected success");
    expect(response.metadata).toMatchObject({
      pixelWidth: 800,
      pixelHeight: 600,
      byteLength: 1234,
    });
    expect("blob" in response).toBe(false);
    expect(isBackgroundCaptureResponse({
      success: true,
      metadata,
      dataUrl: "data:image/png;base64,secret",
    })).toBe(false);
  });

  it("background handler ignores unrelated content messages", () => {
    const coordinator = new CaptureCoordinator(dependencies());
    const handler = createBackgroundCaptureMessageHandler(coordinator);
    const sendResponse = vi.fn();
    expect(handler(
      { type: "SCAN_PAGE" },
      {} as chrome.runtime.MessageSender,
      sendResponse
    )).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("formats SHA-256 as lowercase hexadecimal", async () => {
    const hash = await sha256Hex(new Blob(["mangalens"]));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
