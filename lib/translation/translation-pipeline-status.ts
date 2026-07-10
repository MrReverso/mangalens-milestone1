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
    case "invalid-service-mode":
      return "Choose a valid translation service mode";
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
      return "Local OCR backend is not running";
    case "backend-timeout":
      return "Local OCR processing timed out";
    case "backend-invalid-response":
      return "Local OCR backend returned an invalid result";
    case "backend-request-failed":
    case "backend-http-error":
    case "backend-invalid-content-type":
    case "backend-response-too-large":
    case "backend-invalid-json":
      return "Local OCR request failed";
    case "ocr-provider-disabled":
      return "The selected OCR provider is disabled";
    case "ocr-not-configured":
      return "Google Vision OCR is not configured";
    case "ocr-auth-failed":
      return "Google Vision authentication failed";
    case "ocr-unavailable":
      return "OCR service is unavailable";
    case "ocr-rate-limited":
      return "OCR rate limit reached. Try again later";
    case "ocr-timeout":
      return "OCR timed out";
    case "ocr-response-too-large":
      return "OCR response was too large";
    case "ocr-invalid-response":
      return "OCR returned an invalid result";
    case "ocr-no-text":
      return "No readable text was detected";
    default:
      return "Translation failed";
  }
}
