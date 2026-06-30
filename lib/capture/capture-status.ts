import type { CaptureErrorCode } from "@/types/capture";

export function captureErrorMessage(code: CaptureErrorCode): string {
  switch (code) {
    case "no-detected-pages":
      return "Scan the page first";
    case "no-fully-visible-page":
      return "Scroll until one complete manga page is visible";
    case "capture-in-progress":
      return "A capture is already running";
    case "active-tab-changed":
      return "The active tab changed. Return to the manga tab and try again";
    case "capture-too-large":
      return "This page is too large to capture";
    case "restricted-page":
      return "MangaLens cannot capture this page";
    case "timeout":
      return "Image capture timed out";
    default:
      return "Image capture failed";
  }
}
