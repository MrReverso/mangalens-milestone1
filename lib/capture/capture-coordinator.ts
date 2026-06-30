import {
  CaptureFailure,
  captureErrorCode,
} from "@/lib/capture/capture-errors";
import type { ScreenshotCropper } from "@/lib/capture/screenshot-cropper";
import type {
  BackgroundCaptureResponse,
  CapturedImage,
  CapturePrepareResponse,
} from "@/types/capture";
import {
  isCaptureDescriptor,
  isCaptureErrorCode,
  isRecord,
} from "@/types/capture";
import type {
  BackgroundToContentMessage,
  CaptureFirstVisiblePageMessage,
} from "@/lib/messages";
import { isCaptureFirstVisiblePageMessage } from "@/lib/messages";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RESTORE_TIMEOUT_MS = 1_500;
const DEFAULT_RETIREMENT_TIMEOUT_MS = 5_000;

interface CaptureOperation {
  readonly tabId: number;
  readonly captureToken: string;
  readonly abortController: AbortController;
  prepared: boolean;
  workflowSettled: boolean;
  responseCleanupComplete: boolean;
  retirementTimer: ReturnType<typeof setTimeout> | null;
}

type WorkflowOutcome =
  | { readonly success: true; readonly captured: CapturedImage }
  | { readonly success: false; readonly error: unknown };

export interface CaptureCoordinatorDependencies {
  readonly isTabActive: (tabId: number, windowId: number) => Promise<boolean>;
  readonly sendToTab: (
    tabId: number,
    message: BackgroundToContentMessage
  ) => Promise<unknown>;
  readonly captureVisibleTab: (windowId: number) => Promise<string>;
  readonly cropper: ScreenshotCropper;
  readonly createToken?: () => string;
  readonly timeoutMs?: number;
  readonly restoreTimeoutMs?: number;
  readonly retirementTimeoutMs?: number;
  readonly isTabReserved?: (tabId: number) => boolean;
}

export function createBackgroundCaptureMessageHandler(
  coordinator: CaptureCoordinator
) {
  return (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundCaptureResponse) => void
  ): boolean => {
    if (!isCaptureFirstVisiblePageMessage(message)) return false;
    coordinator.capture(message).then(
      sendResponse,
      () => sendResponse({
        success: false,
        error: { code: "unexpected-error" },
      })
    );
    return true;
  };
}

export class CaptureCoordinator {
  private readonly operations = new Map<number, CaptureOperation>();
  private readonly createToken: () => string;
  private readonly timeoutMs: number;
  private readonly restoreTimeoutMs: number;
  private readonly retirementTimeoutMs: number;

  constructor(private readonly dependencies: CaptureCoordinatorDependencies) {
    this.createToken = dependencies.createToken ?? (() => crypto.randomUUID());
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.restoreTimeoutMs =
      dependencies.restoreTimeoutMs ?? DEFAULT_RESTORE_TIMEOUT_MS;
    this.retirementTimeoutMs =
      dependencies.retirementTimeoutMs ?? DEFAULT_RETIREMENT_TIMEOUT_MS;
  }

  isActive(tabId: number): boolean {
    return this.operations.has(tabId);
  }

  async capture(
    request: CaptureFirstVisiblePageMessage
  ): Promise<BackgroundCaptureResponse> {
    if (this.dependencies.isTabReserved?.(request.tabId)) {
      return { success: false, error: { code: "capture-in-progress" } };
    }
    try {
      const captured = await this.captureImageForInternalUse(request);
      return { success: true, metadata: captured.metadata };
    } catch (error: unknown) {
      return {
        success: false,
        error: { code: captureErrorCode(error) },
      };
    }
  }

  async captureImageForInternalUse(
    request: CaptureFirstVisiblePageMessage,
    parentSignal?: AbortSignal
  ): Promise<CapturedImage> {
    if (!Number.isInteger(request.tabId) || request.tabId <= 0 ||
        !Number.isInteger(request.windowId) || request.windowId <= 0) {
      throw new CaptureFailure("restricted-page");
    }
    if (this.operations.has(request.tabId)) {
      throw new CaptureFailure("capture-in-progress");
    }

    let captureToken: string;
    try {
      captureToken = this.createToken();
    } catch {
      throw new CaptureFailure("unexpected-error");
    }
    const operation: CaptureOperation = {
      tabId: request.tabId,
      captureToken,
      abortController: new AbortController(),
      prepared: false,
      workflowSettled: false,
      responseCleanupComplete: false,
      retirementTimer: null,
    };
    this.operations.set(request.tabId, operation);
    const cancelFromParent = () => operation.abortController.abort();
    parentSignal?.addEventListener("abort", cancelFromParent, { once: true });
    if (parentSignal?.aborted) cancelFromParent();

    const workflowOutcome = this.performCapture(request, operation).then(
      (captured): WorkflowOutcome => ({ success: true, captured }),
      (error: unknown): WorkflowOutcome => ({ success: false, error })
    ).finally(() => {
      operation.workflowSettled = true;
      this.releaseIfRetired(operation);
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutTimer = setTimeout(() => resolve("timeout"), this.timeoutMs);
    });

    let result: CapturedImage | null = null;
    let failure: unknown = null;
    const firstOutcome = await Promise.race([workflowOutcome, timeout]);
    if (firstOutcome === "timeout") {
      operation.abortController.abort();
      failure = new CaptureFailure("timeout");
    } else if (firstOutcome.success) {
      result = firstOutcome.captured;
    } else {
      failure = firstOutcome.error;
    }
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);

    await this.attemptRestore(operation);
    operation.responseCleanupComplete = true;
    this.releaseIfRetired(operation);
    if (!operation.workflowSettled) this.startRetirementDeadline(operation);
    parentSignal?.removeEventListener("abort", cancelFromParent);
    if (failure !== null) {
      throw failure instanceof CaptureFailure
        ? failure
        : new CaptureFailure(captureErrorCode(failure));
    }
    if (!result) throw new CaptureFailure("unexpected-error");
    return result;
  }

  private async performCapture(
    request: CaptureFirstVisiblePageMessage,
    operation: CaptureOperation
  ): Promise<CapturedImage> {
    this.throwIfCancelled(operation);
    const isActive = await this.dependencies.isTabActive(
      request.tabId,
      request.windowId
    );
    this.throwIfCancelled(operation);
    if (!isActive) throw new CaptureFailure("restricted-page");

    this.throwIfCancelled(operation);
    const rawPrepare = await this.dependencies.sendToTab(request.tabId, {
      type: "PREPARE_VISIBLE_PAGE_CAPTURE",
      captureToken: operation.captureToken,
    });
    const prepare = parsePrepareResponse(rawPrepare);
    operation.prepared = prepare?.success === true;
    if (operation.abortController.signal.aborted) {
      if (operation.prepared) await this.attemptRestore(operation);
      this.throwIfCancelled(operation);
    }
    if (!prepare) throw new CaptureFailure("unexpected-error");
    if (!prepare.success) throw new CaptureFailure(prepare.error.code);
    if (!isCaptureDescriptor(prepare.descriptor) ||
        prepare.descriptor.captureToken !== operation.captureToken) {
      throw new CaptureFailure("invalid-geometry");
    }

    await this.ensureTabRemainsActive(request, operation);
    let screenshot: string;
    try {
      screenshot = await this.dependencies.captureVisibleTab(request.windowId);
    } catch {
      throw new CaptureFailure("screenshot-failed");
    }
    this.throwIfCancelled(operation);
    await this.ensureTabRemainsActive(request, operation);

    this.throwIfCancelled(operation);
    const captured = await this.dependencies.cropper.crop(
      screenshot,
      prepare.descriptor,
      operation.abortController.signal
    );
    this.throwIfCancelled(operation);
    this.throwIfCancelled(operation);
    return captured;
  }

  private throwIfCancelled(operation: CaptureOperation): void {
    if (operation.abortController.signal.aborted) {
      throw new CaptureFailure("timeout");
    }
  }

  private async ensureTabRemainsActive(
    request: CaptureFirstVisiblePageMessage,
    operation: CaptureOperation
  ): Promise<void> {
    this.throwIfCancelled(operation);
    const isActive = await this.dependencies.isTabActive(
      request.tabId,
      request.windowId
    );
    this.throwIfCancelled(operation);
    if (!isActive) throw new CaptureFailure("active-tab-changed");
  }

  private async attemptRestore(operation: CaptureOperation): Promise<void> {
    let restore: Promise<void>;
    try {
      restore = this.dependencies.sendToTab(operation.tabId, {
        type: "RESTORE_AFTER_PAGE_CAPTURE",
        captureToken: operation.captureToken,
      }).then(
        () => undefined,
        () => undefined
      );
    } catch {
      return;
    }
    await settleWithin(restore, this.restoreTimeoutMs);
  }

  private releaseIfRetired(operation: CaptureOperation): void {
    if (!operation.workflowSettled || !operation.responseCleanupComplete) return;
    if (operation.retirementTimer !== null) {
      clearTimeout(operation.retirementTimer);
      operation.retirementTimer = null;
    }
    if (this.operations.get(operation.tabId) === operation) {
      this.operations.delete(operation.tabId);
    }
  }

  private startRetirementDeadline(operation: CaptureOperation): void {
    if (operation.retirementTimer !== null) return;
    operation.retirementTimer = setTimeout(() => {
      operation.retirementTimer = null;
      if (this.operations.get(operation.tabId) === operation) {
        this.operations.delete(operation.tabId);
      }
    }, this.retirementTimeoutMs);
  }
}

async function settleWithin(
  operation: Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      operation,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function parsePrepareResponse(value: unknown): CapturePrepareResponse | null {
  if (!isRecord(value) || typeof value.success !== "boolean") return null;
  if (value.success) {
    return isCaptureDescriptor(value.descriptor)
      ? { success: true, descriptor: value.descriptor }
      : null;
  }
  if (!isRecord(value.error) || !isCaptureErrorCode(value.error.code)) {
    return null;
  }
  return {
    success: false,
    error: { code: value.error.code },
  };
}
