import { describe, expect, it, vi } from "vitest";
import {
  canAppendSegment,
  hasSufficientOverlap,
  orderSegments,
  type CapturedSegment,
} from "@/lib/capture/segmented-capture";
import { SegmentedCaptureCoordinator } from "@/lib/capture/segmented-capture-coordinator";
import type { CaptureSegmentDescriptor, CapturedImage } from "@/types/capture";

function descriptor(
  token: string,
  top: number,
  pageId = "page-1"
): CaptureSegmentDescriptor {
  return {
    captureToken: token, sessionId: "session-1", pageId, pageNumber: 1,
    imageRect: { top: 0, left: 0, width: 100, height: 100 },
    viewportWidth: 100, viewportHeight: 100,
    segmentRect: { top, left: 0, width: 100, height: 100 },
    pageWidth: 100, pageHeight: 500, naturalWidth: 100, naturalHeight: 500,
  };
}

function image(pageId = "page-1"): CapturedImage {
  return {
    blob: new Blob(["segment"], { type: "image/png" }),
    metadata: {
      pageId, pageNumber: 1, method: "visible-tab-screenshot-crop",
      mimeType: "image/png", pixelWidth: 100, pixelHeight: 100,
      byteLength: 7, sha256: "a".repeat(64),
    },
  };
}

function segment(token: string, top: number, pageId?: string): CapturedSegment {
  return { descriptor: descriptor(token, top, pageId), image: image(pageId) };
}

describe("segmented capture geometry", () => {
  it("requires meaningful overlap and keeps deterministic reading order", () => {
    expect(hasSufficientOverlap(
      { top: 0, left: 0, width: 100, height: 100 },
      { top: 92, left: 0, width: 100, height: 100 },
    )).toBe(true);
    expect(hasSufficientOverlap(
      { top: 0, left: 0, width: 100, height: 100 },
      { top: 101, left: 0, width: 100, height: 100 },
    )).toBe(false);
    expect(orderSegments([segment("c", 180), segment("a", 0), segment("b", 90)])
      .map((value) => value.descriptor.captureToken)).toEqual(["a", "b", "c"]);
  });

  it("rejects a segment from a changed page", () => {
    expect(canAppendSegment([segment("a", 0)], segment("b", 80, "page-2"))).toBe(false);
  });
});

describe("SegmentedCaptureCoordinator", () => {
  it("cleans a cancelled session and does not expose image bytes in status", async () => {
    const sendToTab = vi.fn().mockResolvedValue({ success: true });
    const coordinator = new SegmentedCaptureCoordinator({
      isTabActive: vi.fn().mockResolvedValue(true), sendToTab,
      captureVisibleTab: vi.fn(), cropper: { crop: vi.fn() },
      translateCapturedImage: vi.fn(), createSessionId: () => "session-1",
    });
    const started = await coordinator.start({
      type: "START_EXPANDED_CAPTURE", tabId: 1, windowId: 1,
      sourceLanguage: "auto", targetLanguage: "en", serviceMode: "development-api",
    });
    expect(started).toEqual({
      success: true,
      status: { sessionId: "session-1", tabId: 1, windowId: 1, pageId: null, pageNumber: null, segmentCount: 0 },
    });
    expect(JSON.stringify(started)).not.toContain("blob");
    expect(coordinator.cancel({ type: "CANCEL_EXPANDED_CAPTURE", tabId: 1, sessionId: "session-1" }))
      .toMatchObject({ success: true });
    expect(coordinator.isActive(1)).toBe(false);
  });

  it("cleans an expired session", async () => {
    vi.useFakeTimers();
    const coordinator = new SegmentedCaptureCoordinator({
      isTabActive: vi.fn().mockResolvedValue(true), sendToTab: vi.fn(),
      captureVisibleTab: vi.fn(), cropper: { crop: vi.fn() },
      translateCapturedImage: vi.fn(), createSessionId: () => "session-2", timeoutMs: 20,
    });
    await coordinator.start({
      type: "START_EXPANDED_CAPTURE", tabId: 2, windowId: 1,
      sourceLanguage: "auto", targetLanguage: "en", serviceMode: "development-api",
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(coordinator.isActive(2)).toBe(false);
    vi.useRealTimers();
  });

  it("rejects an active-tab change before capturing a segment", async () => {
    const isTabActive = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const captureVisibleTab = vi.fn();
    const coordinator = new SegmentedCaptureCoordinator({
      isTabActive, sendToTab: vi.fn(), captureVisibleTab,
      cropper: { crop: vi.fn() }, translateCapturedImage: vi.fn(),
      createSessionId: () => "session-3",
    });
    await coordinator.start({
      type: "START_EXPANDED_CAPTURE", tabId: 3, windowId: 1,
      sourceLanguage: "auto", targetLanguage: "en", serviceMode: "development-api",
    });
    await expect(coordinator.captureSegment({
      type: "CAPTURE_EXPANDED_SEGMENT", tabId: 3, windowId: 1, sessionId: "session-3",
    })).resolves.toEqual({ success: false, error: { code: "active-tab-changed" } });
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });

  it("rejects malformed segment metadata before image capture", async () => {
    const captureVisibleTab = vi.fn();
    const coordinator = new SegmentedCaptureCoordinator({
      isTabActive: vi.fn().mockResolvedValue(true),
      sendToTab: vi.fn().mockResolvedValue({ success: true, descriptor: { nope: true } }),
      captureVisibleTab, cropper: { crop: vi.fn() }, translateCapturedImage: vi.fn(),
      createSessionId: () => "session-4", createCaptureToken: () => "capture-4",
    });
    await coordinator.start({
      type: "START_EXPANDED_CAPTURE", tabId: 4, windowId: 1,
      sourceLanguage: "auto", targetLanguage: "en", serviceMode: "development-api",
    });
    await expect(coordinator.captureSegment({
      type: "CAPTURE_EXPANDED_SEGMENT", tabId: 4, windowId: 1, sessionId: "session-4",
    })).resolves.toEqual({ success: false, error: { code: "invalid-geometry" } });
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });
});
