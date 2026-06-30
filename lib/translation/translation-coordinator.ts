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

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETIREMENT_TIMEOUT_MS = 5_000;

interface TranslationOperation {
  readonly controller: AbortController;
  retirementTimer: ReturnType<typeof setTimeout> | null;
  readonly expiresAt: number;
  readonly operationSequence: number;
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
  readonly service: TranslationService;
  readonly sendToTab: (
    tabId: number,
    message: ApplyTranslationResultMessage
  ) => Promise<unknown>;
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

    const { tabId, windowId, sourceLanguage, targetLanguage } = message;

    if (!isPositiveInteger(tabId) || !isPositiveInteger(windowId)) {
      sendResponse({
        success: false,
        error: { code: "restricted-page" },
      });
      return true;
    }

    const keys = ["type", "tabId", "windowId", "sourceLanguage", "targetLanguage"];
    const hasAllowedKeys = Object.keys(message).every((key) => keys.includes(key)) &&
      keys.every((key) => key in message);

    if (!isSourceLanguage(sourceLanguage) || !isTargetLanguage(targetLanguage) || !hasAllowedKeys) {
      sendResponse({
        success: false,
        error: { code: "invalid-language" },
      });
      return true;
    }

    const validMessage = message as unknown as TranslateVisiblePageMessage;
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
  private readonly nextSequences = new Map<number, number>();
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
    const expiresAt = Date.now() + this.timeoutMs;
    const operationSequence = this.nextSequences.get(request.tabId) ?? 1;
    this.nextSequences.set(request.tabId, operationSequence + 1);

    const operation: TranslationOperation = {
      controller: new AbortController(),
      retirementTimer: null,
      expiresAt,
      operationSequence,
    };
    this.operations.set(request.tabId, operation);

    const workflow = this.performTranslation(
      request,
      operation.controller.signal,
      expiresAt,
      operationSequence
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
      return { success: false, error: { code: "timeout" } };
    }
    if (first.kind === "success") return first.response;
    return {
      success: false,
      error: { code: pipelineErrorCode(first.error) },
    };
  }

  private async performTranslation(
    request: TranslateVisiblePageMessage,
    signal: AbortSignal,
    expiresAt: number,
    operationSequence: number
  ): Promise<BackgroundTranslationResponse> {
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
      rawResponse = await this.dependencies.service.translate({
        image: captured.blob,
        metadata,
      }, signal);
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        throw new TranslationPipelineFailure("timeout");
      }
      throw new TranslationPipelineFailure("translation-service-failed");
    }
    throwIfAborted(signal);
    const response = validateTranslationApiSuccessResponse(rawResponse);
    if (!response ||
        response.requestId !== requestId ||
        response.pageId !== metadata.pageId) {
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
      expiresAt,
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
      localDemo: true,
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
