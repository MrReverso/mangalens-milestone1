import {
  CaptureFailure,
  captureErrorCode,
} from "@/lib/capture/capture-errors";
import type { ScreenshotCropper } from "@/lib/capture/screenshot-cropper";
import type {
  BackgroundCaptureResponse,
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
import { isPopupToBackgroundMessage } from "@/lib/messages";

const DEFAULT_TIMEOUT_MS = 8_000;

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
}

export function createBackgroundCaptureMessageHandler(
  coordinator: CaptureCoordinator
) {
  return (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundCaptureResponse) => void
  ): boolean => {
    if (!isPopupToBackgroundMessage(message)) return false;
    coordinator.capture(message).then(sendResponse);
    return true;
  };
}

export class CaptureCoordinator {
  private readonly activeTabs = new Set<number>();
  private readonly createToken: () => string;
  private readonly timeoutMs: number;

  constructor(private readonly dependencies: CaptureCoordinatorDependencies) {
    this.createToken = dependencies.createToken ?? (() => crypto.randomUUID());
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async capture(
    request: CaptureFirstVisiblePageMessage
  ): Promise<BackgroundCaptureResponse> {
    if (!Number.isInteger(request.tabId) || request.tabId <= 0 ||
        !Number.isInteger(request.windowId) || request.windowId <= 0) {
      return { success: false, error: { code: "restricted-page" } };
    }
    if (this.activeTabs.has(request.tabId)) {
      return { success: false, error: { code: "capture-in-progress" } };
    }
    this.activeTabs.add(request.tabId);
    const captureToken = this.createToken();

    try {
      const metadata = await this.withTimeout(
        this.performCapture(request, captureToken)
      );
      return { success: true, metadata };
    } catch (error: unknown) {
      return { success: false, error: { code: captureErrorCode(error) } };
    } finally {
      try {
        await this.dependencies.sendToTab(request.tabId, {
          type: "RESTORE_AFTER_PAGE_CAPTURE",
          captureToken,
        });
      } catch {
        // Preserve the original result; the content failsafe also restores.
      }
      this.activeTabs.delete(request.tabId);
    }
  }

  private async performCapture(
    request: CaptureFirstVisiblePageMessage,
    captureToken: string
  ) {
    if (!await this.dependencies.isTabActive(request.tabId, request.windowId)) {
      throw new CaptureFailure("restricted-page");
    }
    const rawPrepare = await this.dependencies.sendToTab(request.tabId, {
      type: "PREPARE_VISIBLE_PAGE_CAPTURE",
      captureToken,
    });
    const prepare = parsePrepareResponse(rawPrepare);
    if (!prepare) {
      throw new CaptureFailure("unexpected-error");
    }
    if (!prepare.success) throw new CaptureFailure(prepare.error.code);
    if (!isCaptureDescriptor(prepare.descriptor) ||
        prepare.descriptor.captureToken !== captureToken) {
      throw new CaptureFailure("invalid-geometry");
    }
    let screenshot: string;
    try {
      screenshot = await this.dependencies.captureVisibleTab(request.windowId);
    } catch {
      throw new CaptureFailure("screenshot-failed");
    }
    const captured = await this.dependencies.cropper.crop(
      screenshot,
      prepare.descriptor
    );
    return captured.metadata;
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CaptureFailure("timeout")),
            this.timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
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
