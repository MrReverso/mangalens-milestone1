import { CaptureFailure, captureErrorCode } from "@/lib/capture/capture-errors";
import type { CapturedImage } from "@/types/capture";
import { isRecord, isPositiveInteger } from "@/types/capture";
import type {
  ApplyTranslationResultMessage,
  BackgroundTranslationResponse,
  TranslateVisiblePageMessage,
  TranslationPipelineErrorCode,
  TranslationPipelineStage,
} from "@/types/translation-pipeline";
import {
  isApplyTranslationResultResponse,
  isSourceLanguage,
  isTargetLanguage,
} from "@/types/translation-pipeline";
import {
  validateTranslationApiRequestMetadata,
  validateTranslationApiSuccessResponse,
} from "@/types/translation-api";
import type { TranslationService } from "@/lib/translation/translation-service";

import type {
  TranslationServiceMode,
} from "@/types/translation-pipeline";

const BACKEND_ERRORS = new Set<string>([
  "backend-unavailable",
  "backend-request-failed",
  "backend-http-error",
  "backend-invalid-content-type",
  "backend-response-too-large",
  "backend-invalid-json",
  "backend-invalid-response",
  "backend-timeout",
  "ocr-provider-disabled",
  "ocr-not-configured",
  "ocr-auth-failed",
  "ocr-unavailable",
  "ocr-rate-limited",
  "ocr-timeout",
  "ocr-response-too-large",
  "ocr-invalid-response",
  "ocr-no-text",
]);

function isBackendErrorCode(code: string): boolean {
  return BACKEND_ERRORS.has(code);
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETIREMENT_TIMEOUT_MS = 5_000;

interface TranslationOperation {
  readonly controller: AbortController;
  retirementTimer: ReturnType<typeof setTimeout> | null;
  readonly expiresAt: number;
}

export interface TranslationCoordinatorDependencies {
  readonly captureImage: (
    request: {
      readonly type: "CAPTURE_FIRST_VISIBLE_PAGE";
      readonly tabId: number;
      readonly windowId: number;
    },
    signal: AbortSignal
  ) => Promise<CapturedImage>;
  readonly services: Record<TranslationServiceMode, TranslationService>;
  readonly sendToTab: (
    tabId: number,
    message: ApplyTranslationResultMessage
  ) => Promise<unknown>;
  readonly nextOperationSequence: (tabId: number) => Promise<number>;
  readonly createRequestId?: () => string;
  readonly reportStage?: (
    tabId: number,
    stage: TranslationPipelineStage
  ) => void | Promise<void>;
  readonly timeoutMs?: number;
  readonly retirementTimeoutMs?: number;
  readonly isCaptureActive?: (tabId: number) => boolean;
}

class TranslationPipelineFailure extends Error {
  constructor(readonly code: TranslationPipelineErrorCode) {
    super(code);
    this.name = "TranslationPipelineFailure";
  }
}

export function createBackgroundTranslationMessageHandler(
  coordinator: TranslationCoordinator
) {
  return (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundTranslationResponse) => void
  ): boolean => {
    if (!isRecord(message) || message.type !== "TRANSLATE_VISIBLE_PAGE_LOCAL") {
      return false;
    }

    const { tabId, windowId, sourceLanguage, targetLanguage, serviceMode } = message;

    if (!isPositiveInteger(tabId) || !isPositiveInteger(windowId)) {
      sendResponse({
        success: false,
        error: { code: "restricted-page" },
      });
      return true;
    }

    if (serviceMode !== "local-demo" && serviceMode !== "development-api") {
      sendResponse({
        success: false,
        error: { code: "invalid-service-mode" },
      });
      return true;
    }

    const keys = ["type", "tabId", "windowId", "sourceLanguage", "targetLanguage", "serviceMode"];
    const hasAllowedKeys = Object.keys(message).every((key) => keys.includes(key)) &&
      keys.every((key) => key in message);

    if (!isSourceLanguage(sourceLanguage) ||
        !isTargetLanguage(targetLanguage) ||
        !hasAllowedKeys) {
      sendResponse({
        success: false,
        error: { code: "invalid-language" },
      });
      return true;
    }

    const validMessage: TranslateVisiblePageMessage = {
      type: "TRANSLATE_VISIBLE_PAGE_LOCAL",
      tabId,
      windowId,
      sourceLanguage,
      targetLanguage,
      serviceMode,
    };
    coordinator.translate(validMessage).then(
      sendResponse,
      () => sendResponse({
        success: false,
        error: { code: "unexpected-error" },
      })
    );
    return true;
  };
}

export class TranslationCoordinator {
  private readonly operations = new Map<number, TranslationOperation>();
  private readonly timeoutMs: number;
  private readonly retirementTimeoutMs: number;
  private readonly createRequestId: () => string;

  constructor(private readonly dependencies: TranslationCoordinatorDependencies) {
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retirementTimeoutMs =
      dependencies.retirementTimeoutMs ?? DEFAULT_RETIREMENT_TIMEOUT_MS;
    this.createRequestId =
      dependencies.createRequestId ?? (() => crypto.randomUUID());
  }

  isActive(tabId: number): boolean {
    return this.operations.has(tabId);
  }

  async translate(
    request: TranslateVisiblePageMessage
  ): Promise<BackgroundTranslationResponse> {
    if (this.operations.has(request.tabId) ||
        this.dependencies.isCaptureActive?.(request.tabId)) {
      return { success: false, error: { code: "translation-in-progress" } };
    }
    if (request.serviceMode !== "local-demo" && request.serviceMode !== "development-api") {
      return { success: false, error: { code: "invalid-service-mode" } };
    }
    const service = this.dependencies.services[request.serviceMode];
    if (!service) {
      return { success: false, error: { code: "unexpected-error" } };
    }

    const expiresAt = Date.now() + this.timeoutMs;

    const operation: TranslationOperation = {
      controller: new AbortController(),
      retirementTimer: null,
      expiresAt,
    };
    this.operations.set(request.tabId, operation);

    const workflow = this.performTranslation(
      request,
      operation,
      operation.controller.signal
    );
    const outcome = workflow.then(
      (response) => ({ kind: "success" as const, response }),
      (error: unknown) => ({ kind: "error" as const, error })
    ).finally(() => this.release(request.tabId, operation));

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutDelay = Math.max(0, expiresAt - Date.now());
    const timeout = new Promise<{ readonly kind: "timeout" }>((resolve) => {
      timeoutTimer = setTimeout(() => resolve({ kind: "timeout" }), timeoutDelay);
    });
    const first = await Promise.race([outcome, timeout]);
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);

    if (first.kind === "timeout") {
      operation.controller.abort();
      this.startRetirementDeadline(request.tabId, operation);
      const code = request.serviceMode === "development-api"
        ? "ocr-timeout"
        : "timeout";
      return { success: false, error: { code } };
    }
    if (first.kind === "success") return first.response;
    return {
      success: false,
      error: { code: pipelineErrorCode(first.error) },
    };
  }

  private async performTranslation(
    request: TranslateVisiblePageMessage,
    operation: TranslationOperation,
    signal: AbortSignal
  ): Promise<BackgroundTranslationResponse> {
    throwIfAborted(signal);

    let operationSequence: number;
    try {
      operationSequence = await this.dependencies.nextOperationSequence(request.tabId);
    } catch {
      throw new TranslationPipelineFailure("unexpected-error");
    }

    throwIfAborted(signal);
    await this.reportStage(request.tabId, "capturing");
    throwIfAborted(signal);
    const captured = await this.dependencies.captureImage({
      type: "CAPTURE_FIRST_VISIBLE_PAGE",
      tabId: request.tabId,
      windowId: request.windowId,
    }, signal);
    throwIfAborted(signal);

    let requestId: string;
    try {
      requestId = this.createRequestId();
    } catch {
      throw new TranslationPipelineFailure("unexpected-error");
    }
    const metadata = validateTranslationApiRequestMetadata({
      contractVersion: 1,
      requestId,
      pageId: captured.metadata.pageId,
      pageNumber: captured.metadata.pageNumber,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      capture: captured.metadata,
    });
    if (!metadata) throw new TranslationPipelineFailure("invalid-language");

    throwIfAborted(signal);
    await this.reportStage(request.tabId, "processing");
    throwIfAborted(signal);
    let rawResponse: unknown;
    try {
      const service = this.dependencies.services[request.serviceMode];
      rawResponse = await service.translate({
        image: captured.blob,
        metadata,
      }, signal);
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        throw new TranslationPipelineFailure(
          request.serviceMode === "development-api" ? "ocr-timeout" : "timeout"
        );
      }
      if (error instanceof Error && isBackendErrorCode(error.message)) {
        throw new TranslationPipelineFailure(error.message as TranslationPipelineErrorCode);
      }
      throw new TranslationPipelineFailure("translation-service-failed");
    }
    throwIfAborted(signal);
    const response = validateTranslationApiSuccessResponse(rawResponse);
    if (!response ||
        response.requestId !== requestId ||
        response.pageId !== metadata.pageId) {
      if (request.serviceMode === "development-api") {
        throw new TranslationPipelineFailure("backend-invalid-response");
      }
      throw new TranslationPipelineFailure("invalid-translation-response");
    }

    throwIfAborted(signal);
    await this.reportStage(request.tabId, "applying");
    throwIfAborted(signal);
    const applyRaw = await this.dependencies.sendToTab(request.tabId, {
      type: "APPLY_TRANSLATION_RESULT",
      contractVersion: 1,
      requestId,
      pageId: response.pageId,
      bubbles: response.bubbles,
      expiresAt: operation.expiresAt,
      operationSequence,
    });
    throwIfAborted(signal);
    if (!isApplyTranslationResultResponse(applyRaw)) {
      throw new TranslationPipelineFailure("apply-failed");
    }
    if (!applyRaw.success) {
      throw new TranslationPipelineFailure(applyRaw.error.code);
    }
    if (applyRaw.pageId !== response.pageId ||
        applyRaw.bubbleCount !== response.bubbles.length) {
      throw new TranslationPipelineFailure("apply-failed");
    }
    throwIfAborted(signal);
    return {
      success: true,
      pageId: response.pageId,
      pageNumber: metadata.pageNumber,
      bubbleCount: response.bubbles.length,
      resultKind: request.serviceMode === "local-demo"
        ? "local-demo"
        : "ocr-preview",
      serviceMode: request.serviceMode,
    };
  }

  private async reportStage(
    tabId: number,
    stage: TranslationPipelineStage
  ): Promise<void> {
    try {
      await this.dependencies.reportStage?.(tabId, stage);
    } catch {
      // Progress is best-effort and never controls the pipeline.
    }
  }

  private release(tabId: number, operation: TranslationOperation): void {
    if (operation.retirementTimer !== null) {
      clearTimeout(operation.retirementTimer);
      operation.retirementTimer = null;
    }
    if (this.operations.get(tabId) === operation) this.operations.delete(tabId);
  }

  private startRetirementDeadline(
    tabId: number,
    operation: TranslationOperation
  ): void {
    if (operation.retirementTimer !== null) return;
    operation.retirementTimer = setTimeout(
      () => this.release(tabId, operation),
      this.retirementTimeoutMs
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TranslationPipelineFailure("timeout");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function pipelineErrorCode(error: unknown): TranslationPipelineErrorCode {
  if (error instanceof TranslationPipelineFailure) return error.code;
  if (error instanceof CaptureFailure) return captureErrorCode(error);
  return "unexpected-error";
}
