import type { TranslationPipelineErrorCode } from "@/types/translation-pipeline";

export function translationPipelineErrorMessage(
  code: TranslationPipelineErrorCode
): string {
  switch (code) {
    case "no-detected-pages":
      return "Scan the page first";
    case "no-fully-visible-page":
      return "Scroll until one complete manga page is visible";
    case "active-tab-changed":
      return "The active tab changed. Return to the manga tab and try again";
    case "translation-in-progress":
      return "A translation is already running";
    case "invalid-language":
      return "Choose valid source and target languages";
    case "translation-service-failed":
      return "Local translation processing failed";
    case "target-page-missing":
      return "The manga page is no longer available";
    case "target-page-disconnected":
      return "The manga page was removed";
    case "invalid-translation-response":
      return "The translation result was invalid";
    case "timeout":
      return "Translation timed out";
    case "backend-unavailable":
      return "Development translation server is not running";
    case "backend-timeout":
      return "Development translation timed out";
    case "backend-invalid-response":
      return "Development server returned an invalid result";
    case "backend-request-failed":
    case "backend-http-error":
    case "backend-invalid-content-type":
    case "backend-response-too-large":
    case "backend-invalid-json":
      return "Development translation request failed";
    default:
      return "Translation failed";
  }
}
