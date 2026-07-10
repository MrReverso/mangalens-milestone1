import { CaptureFailure, captureErrorCode } from "@/lib/capture/capture-errors";
import type { ScreenshotCropper } from "@/lib/capture/screenshot-cropper";
import {
  assembleSegments,
  canAppendSegment,
  type CapturedSegment,
} from "@/lib/capture/segmented-capture";
import type {
  CapturedImage,
  CaptureSegmentPrepareResponse,
  SegmentedCaptureSessionStatus,
} from "@/types/capture";
import {
  isCaptureErrorCode,
  isCaptureSegmentDescriptor,
  isRecord,
} from "@/types/capture";
import type {
  BackgroundToContentMessage,
  CancelExpandedCaptureMessage,
  CaptureExpandedSegmentMessage,
  ExpandedCaptureResponse,
  FinishExpandedCaptureMessage,
  GetExpandedCaptureStatusMessage,
  StartExpandedCaptureMessage,
} from "@/lib/messages";
import {
  isCancelExpandedCaptureMessage,
  isCaptureExpandedSegmentMessage,
  isFinishExpandedCaptureMessage,
  isGetExpandedCaptureStatusMessage,
  isStartExpandedCaptureMessage,
} from "@/lib/messages";
import type { BackgroundTranslationResponse, TranslateVisiblePageMessage } from "@/types/translation-pipeline";

const SESSION_TIMEOUT_MS = 3 * 60_000;

interface Session {
  readonly id: string;
  readonly tabId: number;
  readonly windowId: number;
  readonly request: TranslateVisiblePageMessage;
  readonly controller: AbortController;
  readonly segments: CapturedSegment[];
  timer: ReturnType<typeof setTimeout>;
  captureActive: boolean;
}

export interface SegmentedCaptureCoordinatorDependencies {
  readonly isTabActive: (tabId: number, windowId: number) => Promise<boolean>;
  readonly sendToTab: (tabId: number, message: BackgroundToContentMessage) => Promise<unknown>;
  readonly captureVisibleTab: (windowId: number) => Promise<string>;
  readonly cropper: ScreenshotCropper;
  readonly translateCapturedImage: (
    request: TranslateVisiblePageMessage,
    captured: CapturedImage
  ) => Promise<BackgroundTranslationResponse>;
  readonly createSessionId?: () => string;
  readonly createCaptureToken?: () => string;
  readonly timeoutMs?: number;
  readonly assemble?: (segments: readonly CapturedSegment[], signal: AbortSignal) => Promise<CapturedImage>;
  readonly isTabReserved?: (tabId: number) => boolean;
}

export class SegmentedCaptureCoordinator {
  private readonly sessions = new Map<string, Session>();
  private readonly sessionByTab = new Map<number, string>();
  private readonly createSessionId: () => string;
  private readonly createCaptureToken: () => string;
  private readonly timeoutMs: number;
  private readonly assemble: NonNullable<SegmentedCaptureCoordinatorDependencies["assemble"]>;

  constructor(private readonly dependencies: SegmentedCaptureCoordinatorDependencies) {
    this.createSessionId = dependencies.createSessionId ?? (() => crypto.randomUUID());
    this.createCaptureToken = dependencies.createCaptureToken ?? (() => crypto.randomUUID());
    this.timeoutMs = dependencies.timeoutMs ?? SESSION_TIMEOUT_MS;
    this.assemble = dependencies.assemble ?? assembleSegments;
  }

  isActive(tabId: number): boolean {
    return this.sessionByTab.has(tabId);
  }

  async start(request: StartExpandedCaptureMessage): Promise<ExpandedCaptureResponse> {
    if (this.isActive(request.tabId) || this.dependencies.isTabReserved?.(request.tabId)) {
      return failure("capture-in-progress");
    }
    if (!await this.dependencies.isTabActive(request.tabId, request.windowId)) {
      return failure("active-tab-changed");
    }
    let id: string;
    try {
      id = this.createSessionId();
    } catch {
      return failure("unexpected-error");
    }
    const session: Session = {
      id,
      tabId: request.tabId,
      windowId: request.windowId,
      request: {
        type: "TRANSLATE_VISIBLE_PAGE_LOCAL",
        tabId: request.tabId,
        windowId: request.windowId,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        serviceMode: request.serviceMode,
      },
      controller: new AbortController(),
      segments: [],
      timer: setTimeout(() => this.dispose(id), this.timeoutMs),
      captureActive: false,
    };
    this.sessions.set(id, session);
    this.sessionByTab.set(request.tabId, id);
    return { success: true, status: statusFor(session) };
  }

  status(request: GetExpandedCaptureStatusMessage): ExpandedCaptureResponse {
    const session = this.getSession(this.sessionByTab.get(request.tabId));
    if (!session || session.tabId !== request.tabId || session.windowId !== request.windowId) {
      return failure("capture-session-not-found");
    }
    return { success: true, status: statusFor(session) };
  }

  async captureSegment(
    request: CaptureExpandedSegmentMessage
  ): Promise<ExpandedCaptureResponse> {
    const session = this.getSession(request.sessionId);
    if (!session || session.tabId !== request.tabId || session.windowId !== request.windowId) {
      return failure("capture-session-not-found");
    }
    if (session.captureActive) return failure("capture-in-progress");
    session.captureActive = true;
    let captureToken = "";
    try {
      if (!await this.dependencies.isTabActive(session.tabId, session.windowId)) {
        throw new CaptureFailure("active-tab-changed");
      }
      captureToken = this.createCaptureToken();
      const prepare = parseSegmentPrepare(await this.dependencies.sendToTab(session.tabId, {
        type: "PREPARE_CAPTURE_SEGMENT",
        captureToken,
        sessionId: session.id,
        expectedPageId: session.segments[0]?.descriptor.pageId ?? null,
      }));
      if (!prepare) throw new CaptureFailure("invalid-geometry");
      if (!prepare.success) throw new CaptureFailure(prepare.error.code);
      if (prepare.descriptor.captureToken !== captureToken ||
          prepare.descriptor.sessionId !== session.id) {
        throw new CaptureFailure("stale-capture-session");
      }
      if (!await this.dependencies.isTabActive(session.tabId, session.windowId)) {
        throw new CaptureFailure("active-tab-changed");
      }
      const screenshot = await this.dependencies.captureVisibleTab(session.windowId)
        .catch(() => { throw new CaptureFailure("screenshot-failed"); });
      if (!await this.dependencies.isTabActive(session.tabId, session.windowId)) {
        throw new CaptureFailure("active-tab-changed");
      }
      const image = await this.dependencies.cropper.crop(
        screenshot,
        prepare.descriptor,
        session.controller.signal
      );
      const segment: CapturedSegment = { descriptor: prepare.descriptor, image };
      if (!canAppendSegment(session.segments, segment)) {
        throw new CaptureFailure(session.segments.length ? "low-overlap" : "stale-capture-session");
      }
      session.segments.push(segment);
      return { success: true, status: statusFor(session) };
    } catch (error: unknown) {
      return failure(captureErrorCode(error));
    } finally {
      session.captureActive = false;
      if (captureToken) {
        await this.dependencies.sendToTab(session.tabId, {
          type: "RESTORE_AFTER_PAGE_CAPTURE", captureToken,
        }).catch(() => undefined);
      }
    }
  }

  async finish(request: FinishExpandedCaptureMessage): Promise<BackgroundTranslationResponse> {
    const session = this.getSession(request.sessionId);
    if (!session || session.tabId !== request.tabId || session.windowId !== request.windowId) {
      return { success: false, error: { code: "capture-session-not-found" } };
    }
    if (session.captureActive) return { success: false, error: { code: "capture-in-progress" } };
    if (!session.segments.length) return { success: false, error: { code: "capture-session-not-found" } };
    try {
      if (!await this.dependencies.isTabActive(session.tabId, session.windowId)) {
        throw new CaptureFailure("active-tab-changed");
      }
      const assembled = await this.assemble(session.segments, session.controller.signal);
      const response = await this.dependencies.translateCapturedImage(session.request, assembled);
      this.dispose(session.id);
      return response;
    } catch (error: unknown) {
      return { success: false, error: { code: captureErrorCode(error) } };
    }
  }

  cancel(request: CancelExpandedCaptureMessage): ExpandedCaptureResponse {
    const session = this.getSession(request.sessionId);
    if (!session || session.tabId !== request.tabId) return failure("capture-session-not-found");
    const status = statusFor(session);
    this.dispose(session.id);
    return { success: true, status };
  }

  private getSession(id: string | undefined): Session | undefined {
    return id ? this.sessions.get(id) : undefined;
  }

  private dispose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.controller.abort();
    clearTimeout(session.timer);
    session.segments.splice(0);
    this.sessions.delete(id);
    if (this.sessionByTab.get(session.tabId) === id) this.sessionByTab.delete(session.tabId);
  }
}

export function createExpandedCaptureMessageHandler(
  coordinator: SegmentedCaptureCoordinator
) {
  return (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ): boolean => {
    if (isStartExpandedCaptureMessage(message)) {
      coordinator.start(message).then(sendResponse);
      return true;
    }
    if (isCaptureExpandedSegmentMessage(message)) {
      coordinator.captureSegment(message).then(sendResponse);
      return true;
    }
    if (isFinishExpandedCaptureMessage(message)) {
      coordinator.finish(message).then(sendResponse);
      return true;
    }
    if (isCancelExpandedCaptureMessage(message)) {
      sendResponse(coordinator.cancel(message));
      return true;
    }
    if (isGetExpandedCaptureStatusMessage(message)) {
      sendResponse(coordinator.status(message));
      return true;
    }
    return false;
  };
}

function statusFor(session: Session): SegmentedCaptureSessionStatus {
  const first = session.segments[0]?.descriptor;
  return {
    sessionId: session.id, tabId: session.tabId, windowId: session.windowId,
    pageId: first?.pageId ?? null, pageNumber: first?.pageNumber ?? null,
    segmentCount: session.segments.length,
  };
}

function failure(code: string): ExpandedCaptureResponse {
  return { success: false, error: { code } };
}

function parseSegmentPrepare(value: unknown): CaptureSegmentPrepareResponse | null {
  if (!isRecord(value) || typeof value.success !== "boolean") return null;
  if (value.success) {
    return isCaptureSegmentDescriptor(value.descriptor)
      ? { success: true, descriptor: value.descriptor } : null;
  }
  return isRecord(value.error) && isCaptureErrorCode(value.error.code)
    ? { success: false, error: { code: value.error.code } } : null;
}
