import { useState, useEffect, useCallback, useRef } from "react";
import LanguageSelect from "@/components/LanguageSelect";
import {
  SOURCE_LANGUAGE_OPTIONS,
  TARGET_LANGUAGE_OPTIONS,
} from "@/types/extension";
import type {
  SourceLanguage,
  TargetLanguage,
} from "@/types/extension";
import { getSettings, saveSettings } from "@/lib/storage";
import type {
  ScanPageResponse,
  ScanStatusResponse,
  TranslationCommandResponse,
  TranslationStatusResponse,
  BackgroundCaptureResponse,
  ExpandedCaptureResponse,
  ReaderSessionStatusResponse,
} from "@/lib/messages";
import {
  isExpandedCaptureResponse,
  isReaderSessionCommandResponse,
  isReaderSessionStatusResponse,
} from "@/lib/messages";
import { isBackgroundCaptureResponse } from "@/types/capture";
import { captureErrorMessage } from "@/lib/capture/capture-status";
import {
  isBackgroundTranslationResponse,
  isTranslationPipelineProgressMessage,
} from "@/types/translation-pipeline";
import type { TranslationPipelineStage, TranslationServiceMode } from "@/types/translation-pipeline";
import { translationPipelineErrorMessage } from "@/lib/translation/translation-pipeline-status";
import "./style.css";

// ── Status States ──────────────────────────────────────────────

type StatusKind =
  | "ready"
  | "scanning"
  | "success"
  | "not-found"
  | "no-access"
  | "error";

interface StatusState {
  kind: StatusKind;
  message: string;
}

const INITIAL_STATUS: StatusState = {
  kind: "ready",
  message: "Open a manga or webtoon chapter to begin",
};

// ── Injection helper ───────────────────────────────────────────
// The content script is an unlisted script injected programmatically.
// We attempt to communicate first; if that fails we inject and retry.

const RESTRICTED_PROTOCOLS = new Set([
  "about:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "view-source:",
]);

function canRunOnPage(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return false;
    if (parsed.hostname === "chrome.google.com" &&
        parsed.pathname.startsWith("/webstore")) return false;
    if (parsed.hostname === "chromewebstore.google.com") return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function ensureContentScript(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !canRunOnPage(tab.url)) {
    throw new Error("restricted-page");
  }

  try {
    // Probe: if the content script is already injected, this succeeds.
    await chrome.tabs.sendMessage(tab.id, { type: "GET_SCAN_STATUS" as const });
  } catch {
    // Content script not present — inject it.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["unlisted-content.js"],
    });
  }
}

// ── App Component ──────────────────────────────────────────────

export default function App() {
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>("auto");
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("en");
  const [status, setStatus] = useState<StatusState>(INITIAL_STATUS);
  const [isScanning, setIsScanning] = useState(false);
  const [hasMarkers, setHasMarkers] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationsVisible, setTranslationsVisible] = useState(true);
  const [hasTranslations, setHasTranslations] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isLocalTranslating, setIsLocalTranslating] = useState(false);
  const [localStage, setLocalStage] =
    useState<TranslationPipelineStage>("capturing");
  const [currentServiceMode, setCurrentServiceMode] =
    useState<TranslationServiceMode>("local-demo");
  const localTranslationTabId = useRef<number | null>(null);
  const currentServiceModeRef =
    useRef<TranslationServiceMode>("local-demo");
  const [expandedSession, setExpandedSession] = useState<{
    sessionId: string;
    segmentCount: number;
  } | null>(null);
  const [isExpandedCaptureBusy, setIsExpandedCaptureBusy] = useState(false);
  const [readerSession, setReaderSession] =
    useState<ReaderSessionStatusResponse | null>(null);
  const [localAiEnabled, setLocalAiEnabled] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ── Load persisted settings on mount ─────────────────────────
  useEffect(() => {
    getSettings().then((settings) => {
      setSourceLanguage(settings.sourceLanguage);
      setTargetLanguage(settings.targetLanguage);
      setTranslationsVisible(settings.translationsVisible);
      setLocalAiEnabled(settings.localAiEnabled);
      checkScanStatus(settings.translationsVisible);
      refreshReaderSessionStatus().catch(() => undefined);
      refreshExpandedCaptureStatus().catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    const listener = (message: unknown): void => {
      if (!isTranslationPipelineProgressMessage(message) ||
          message.tabId !== localTranslationTabId.current) return;
      setLocalStage(message.stage);
      const isOcr = currentServiceModeRef.current === "development-api";
      const progressText: Record<TranslationPipelineStage, string> = isOcr
        ? {
            capturing: "Capturing Page\u2026",
            processing: "Running Local OCR + Translation\u2026",
            applying: "Applying Text Overlays\u2026",
          }
        : {
            capturing: "Capturing Page\u2026",
            processing: "Processing Translation\u2026",
            applying: "Applying Translation\u2026",
          };
      setStatus({ kind: "scanning", message: progressText[message.stage] });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Persist language changes ─────────────────────────────────
  const handleSourceChange = useCallback((value: string) => {
    const lang = value as SourceLanguage;
    setSourceLanguage(lang);
    saveSettings({ sourceLanguage: lang, targetLanguage, translationsVisible, localAiEnabled });
  }, [targetLanguage, translationsVisible, localAiEnabled]);

  const handleTargetChange = useCallback((value: string) => {
    const lang = value as TargetLanguage;
    setTargetLanguage(lang);
    saveSettings({ sourceLanguage, targetLanguage: lang, translationsVisible, localAiEnabled });
  }, [sourceLanguage, translationsVisible, localAiEnabled]);

  // ── Get active tab ────────────────────────────────────────────
  async function getActiveTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) {
      throw new Error("no-tab");
    }
    return tab;
  }

  async function refreshExpandedCaptureStatus(): Promise<void> {
    const tab = await getActiveTab();
    if (!tab.id || !tab.windowId) return;
    const raw: unknown = await chrome.runtime.sendMessage({
      type: "GET_EXPANDED_CAPTURE_STATUS", tabId: tab.id, windowId: tab.windowId,
    });
    if (!isExpandedCaptureResponse(raw)) return;
    if (raw.success) {
      setExpandedSession({
        sessionId: raw.status.sessionId,
        segmentCount: raw.status.segmentCount,
      });
    }
  }

  async function refreshReaderSessionStatus(): Promise<void> {
    const tab = await getActiveTab();
    if (!tab.id) return;
    const raw: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_READER_SESSION_STATUS" as const,
    });
    if (isReaderSessionStatusResponse(raw)) setReaderSession(raw);
  }

  async function handlePrepareChapter(): Promise<void> {
    setIsScanning(true);
    setStatus({ kind: "scanning", message: "Finding chapter pages…" });
    try {
      const tab = await getActiveTab();
      await ensureContentScript(tab);
      const raw: unknown = await chrome.tabs.sendMessage(tab.id!, {
        type: "START_READER_SESSION" as const,
      });
      if (!isReaderSessionCommandResponse(raw) || !raw.success) {
        throw new Error("reader-session-failed");
      }
      setReaderSession(raw.status);
      setHasMarkers(raw.status.totalPages > 0);
      setStatus(raw.status.totalPages > 0
        ? { kind: "success", message: `${raw.status.totalPages} chapter pages ready` }
        : { kind: "not-found", message: "No manga pages found on this site" });
    } catch (error: unknown) {
      setStatus({
        kind: "error",
        message: error instanceof Error && error.message === "restricted-page"
          ? "MangaLens cannot run on this page"
          : "Could not prepare this chapter",
      });
    } finally {
      setIsScanning(false);
    }
  }

  async function handleStopReaderSession(): Promise<void> {
    try {
      const tab = await getActiveTab();
      const raw: unknown = await chrome.tabs.sendMessage(tab.id!, {
        type: "STOP_READER_SESSION" as const,
      });
      if (isReaderSessionCommandResponse(raw) && raw.success) {
        setReaderSession(raw.status);
      }
    } finally {
      setHasMarkers(false);
      setHasTranslations(false);
      setExpandedSession(null);
      setStatus(INITIAL_STATUS);
    }
  }

  async function handleLocalAiSetting(enabled: boolean): Promise<void> {
    setLocalAiEnabled(enabled);
    await saveSettings({
      sourceLanguage,
      targetLanguage,
      translationsVisible,
      localAiEnabled: enabled,
    });
  }

  // ── Check existing scan status ───────────────────────────────
  async function checkScanStatus(preferredVisibility: boolean): Promise<void> {
    try {
      const tab = await getActiveTab();
      if (!tab.id) return;

      const response: ScanStatusResponse = await chrome.tabs.sendMessage(
        tab.id,
        { type: "GET_SCAN_STATUS" as const }
      );
      if (response.detectedImages > 0) {
        setHasMarkers(true);
        setStatus({
          kind: "success",
          message: `${response.detectedImages} manga pages detected`,
        });
        await chrome.tabs.sendMessage(tab.id, {
          type: "SET_TRANSLATIONS_VISIBLE" as const,
          visible: preferredVisibility,
        });
        const translationStatus: TranslationStatusResponse =
          await chrome.tabs.sendMessage(tab.id, {
            type: "GET_TRANSLATION_STATUS" as const,
          });
        applyTranslationStatus(translationStatus);
      }
    } catch {
      // Content script not injected yet — that's expected.
    }
  }

  // ── Scan Page ────────────────────────────────────────────────
  async function handleScan(): Promise<void> {
    setIsScanning(true);
    setStatus({ kind: "scanning", message: "Scanning page\u2026" });

    try {
      const tab = await getActiveTab();
      if (!tab.id) {
        setStatus({
          kind: "no-access",
          message: "MangaLens cannot run on this page",
        });
        setIsScanning(false);
        return;
      }

      // Ensure the content script is injected before sending commands.
      await ensureContentScript(tab);
      await chrome.tabs.sendMessage(tab.id, {
        type: "SET_TRANSLATIONS_VISIBLE" as const,
        visible: translationsVisible,
      });

      const response: ScanPageResponse = await chrome.tabs.sendMessage(
        tab.id,
        { type: "SCAN_PAGE" as const }
      );

      if (response.success) {
        const count = response.detectedImages;
        if (count === 0) {
          setStatus({ kind: "not-found", message: "No manga images found" });
          setHasMarkers(false);
        } else {
          setStatus({
            kind: "success",
            message: `${count} manga pages detected`,
          });
          setHasMarkers(true);
        }
      } else {
        setStatus({ kind: "error", message: response.error });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "restricted-page") {
        setStatus({
          kind: "no-access",
          message: "MangaLens cannot run on this page",
        });
        return;
      }
      setStatus({
        kind: "error",
        message: "An unexpected error occurred",
      });
    } finally {
      setIsScanning(false);
    }
  }

  function applyTranslationStatus(value: TranslationStatusResponse): void {
    const active = value.queuedPages + value.translatingPages > 0;
    setIsTranslating(active);
    setHasTranslations(value.completedPages > 0);
    setTranslationsVisible(value.translationsVisible);
    if (active) {
      setStatus({
        kind: "scanning",
        message: `${value.completedPages} of ${value.totalPages} pages translated`,
      });
    } else if (value.failedPages > 0) {
      setStatus({ kind: "error", message: "Translation preview failed" });
    } else if (value.completedPages > 0 &&
               value.completedPages === value.totalPages) {
      setStatus({ kind: "success", message: "Translation preview complete" });
    }
  }

  async function pollTranslationStatus(tabId: number): Promise<void> {
    const response: TranslationStatusResponse = await chrome.tabs.sendMessage(
      tabId,
      { type: "GET_TRANSLATION_STATUS" as const }
    );
    applyTranslationStatus(response);
    if (response.queuedPages + response.translatingPages > 0) {
      window.setTimeout(() => {
        pollTranslationStatus(tabId).catch(() => {
          setIsTranslating(false);
          setStatus({ kind: "error", message: "Translation preview failed" });
        });
      }, 150);
    }
  }

  async function handlePreviewTranslation(): Promise<void> {
    setIsTranslating(true);
    setStatus({ kind: "scanning", message: "Preparing translations\u2026" });
    try {
      const tab = await getActiveTab();
      await ensureContentScript(tab);
      const response: TranslationCommandResponse =
        await chrome.tabs.sendMessage(tab.id!, {
          type: "START_MOCK_TRANSLATION" as const,
          sourceLanguage,
          targetLanguage,
        });
      if (!response.success) throw new Error("translation-failed");
      applyTranslationStatus(response.status);
      await pollTranslationStatus(tab.id!);
    } catch {
      setIsTranslating(false);
      setStatus({ kind: "error", message: "Translation preview failed" });
    }
  }

  async function handleTranslationVisibility(visible: boolean): Promise<void> {
    setTranslationsVisible(visible);
    await saveSettings({ sourceLanguage, targetLanguage, translationsVisible: visible, localAiEnabled });
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id!, {
        type: "SET_TRANSLATIONS_VISIBLE" as const,
        visible,
      });
    } catch {
      // The page has not been scanned yet.
    }
  }

  async function handleClearTranslations(): Promise<void> {
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id!, {
        type: "CLEAR_TRANSLATIONS" as const,
      });
    } catch {
      // Page may have navigated away.
    }
    setIsTranslating(false);
    setHasTranslations(false);
    setStatus({ kind: "success", message: "Translation preview cancelled" });
  }

  async function handleTestCapture(): Promise<void> {
    setIsCapturing(true);
    setStatus({ kind: "scanning", message: "Testing image capture\u2026" });
    try {
      const tab = await getActiveTab();
      if (!tab.id || !tab.windowId) throw new Error("restricted-page");
      await ensureContentScript(tab);
      const rawResponse: unknown = await chrome.runtime.sendMessage({
          type: "CAPTURE_FIRST_VISIBLE_PAGE" as const,
          tabId: tab.id,
          windowId: tab.windowId,
        });
      if (!isBackgroundCaptureResponse(rawResponse)) {
        throw new Error("invalid-capture-response");
      }
      const response: BackgroundCaptureResponse = rawResponse;
      if (!response.success) {
        setStatus({
          kind: "error",
          message: captureErrorMessage(response.error.code),
        });
        return;
      }
      const sizeKb = Math.max(1, Math.round(response.metadata.byteLength / 1024));
      setStatus({
        kind: "success",
        message: `Captured Page ${response.metadata.pageNumber} \u00b7 ` +
          `${response.metadata.pixelWidth}\u00d7${response.metadata.pixelHeight} ` +
          `\u00b7 ${sizeKb} KB`,
      });
    } catch (error: unknown) {
      setStatus({
        kind: "error",
        message: error instanceof Error && error.message === "restricted-page"
          ? "MangaLens cannot capture this page"
          : "Image capture failed",
      });
    } finally {
      setIsCapturing(false);
    }
  }

  async function handleLocalTranslation(mode: TranslationServiceMode): Promise<void> {
    setIsLocalTranslating(true);
    setCurrentServiceMode(mode);
    currentServiceModeRef.current = mode;
    setLocalStage("capturing");
    setStatus({ kind: "scanning", message: "Capturing Page\u2026" });
    try {
      const tab = await getActiveTab();
      if (!tab.id || !tab.windowId) throw new Error("restricted-page");
      localTranslationTabId.current = tab.id;
      await ensureContentScript(tab);
      const rawResponse: unknown = await chrome.runtime.sendMessage({
        type: "TRANSLATE_VISIBLE_PAGE_LOCAL",
        tabId: tab.id,
        windowId: tab.windowId,
        sourceLanguage,
        targetLanguage,
        serviceMode: mode,
      });
      if (!isBackgroundTranslationResponse(rawResponse)) {
        throw new Error("invalid-translation-response");
      }
      if (!rawResponse.success) {
        const mappedMessage = translationPipelineErrorMessage(
          rawResponse.error.code
        );
        setStatus({
          kind: "error",
          message: mode === "development-api" &&
            mappedMessage === "Translation failed"
            ? "OCR failed"
            : mappedMessage,
        });
        return;
      }
      setHasTranslations(true);
      if (rawResponse.resultKind === "translated-preview") {
        setStatus({
          kind: "success",
          message: `Local translation preview applied to ${rawResponse.bubbleCount} text regions`,
        });
      } else if (rawResponse.resultKind === "translated-local") {
        setStatus({
          kind: "success",
          message: `Local translation applied to ${rawResponse.bubbleCount} text regions`,
        });
      } else if (rawResponse.resultKind === "ocr-fallback") {
        setStatus({
          kind: "success",
          message: `OCR detected ${rawResponse.bubbleCount} text regions · Translation unavailable`,
        });
      } else if (rawResponse.resultKind === "ocr-preview") {
        setStatus({
          kind: "success",
          message: `OCR detected ${rawResponse.bubbleCount} text regions ` +
            "\u00b7 Translation not enabled",
        });
      } else {
        setStatus({
          kind: "success",
          message: `Translated Page ${rawResponse.pageNumber} \u00b7 ` +
            `${rawResponse.bubbleCount} bubbles \u00b7 Local demo`,
        });
      }
    } catch {
      setStatus({
        kind: "error",
        message: mode === "development-api" ? "OCR failed" : "Translation failed",
      });
    } finally {
      localTranslationTabId.current = null;
      setIsLocalTranslating(false);
    }
  }

  function expandedErrorMessage(response: ExpandedCaptureResponse): string {
    return response.success ? "" : captureErrorMessage(
      response.error.code as import("@/types/capture").CaptureErrorCode
    );
  }

  async function handleStartExpandedCapture(): Promise<void> {
    setIsExpandedCaptureBusy(true);
    try {
      const tab = await getActiveTab();
      if (!tab.id || !tab.windowId) throw new Error("restricted-page");
      await ensureContentScript(tab);
      const raw: unknown = await chrome.runtime.sendMessage({
        type: "START_EXPANDED_CAPTURE", tabId: tab.id, windowId: tab.windowId,
        sourceLanguage, targetLanguage, serviceMode: "development-api",
      });
      if (!isExpandedCaptureResponse(raw)) throw new Error("invalid-response");
      if (!raw.success) {
        setStatus({ kind: "error", message: expandedErrorMessage(raw) });
        return;
      }
      setExpandedSession({ sessionId: raw.status.sessionId, segmentCount: 0 });
      setStatus({ kind: "success", message: "Long-page capture started. Capture this view, then scroll manually." });
    } catch {
      setStatus({ kind: "error", message: "Could not start long-page capture" });
    } finally {
      setIsExpandedCaptureBusy(false);
    }
  }

  async function handleCaptureExpandedSegment(): Promise<void> {
    if (!expandedSession) return;
    setIsExpandedCaptureBusy(true);
    try {
      const tab = await getActiveTab();
      if (!tab.id || !tab.windowId) throw new Error("restricted-page");
      const raw: unknown = await chrome.runtime.sendMessage({
        type: "CAPTURE_EXPANDED_SEGMENT", tabId: tab.id, windowId: tab.windowId,
        sessionId: expandedSession.sessionId,
      });
      if (!isExpandedCaptureResponse(raw)) throw new Error("invalid-response");
      if (!raw.success) {
        setStatus({ kind: "error", message: expandedErrorMessage(raw) });
        return;
      }
      setExpandedSession({ sessionId: raw.status.sessionId, segmentCount: raw.status.segmentCount });
      setStatus({ kind: "success", message: `Captured ${raw.status.segmentCount} segment${raw.status.segmentCount === 1 ? "" : "s"}. Scroll manually with overlap, then continue.` });
    } catch {
      setStatus({ kind: "error", message: "Long-page segment capture failed" });
    } finally {
      setIsExpandedCaptureBusy(false);
    }
  }

  async function handleFinishExpandedCapture(): Promise<void> {
    if (!expandedSession) return;
    setIsExpandedCaptureBusy(true);
    setStatus({ kind: "scanning", message: "Assembling local capture and processing OCR…" });
    try {
      const tab = await getActiveTab();
      if (!tab.id || !tab.windowId) throw new Error("restricted-page");
      localTranslationTabId.current = tab.id;
      currentServiceModeRef.current = "development-api";
      const raw: unknown = await chrome.runtime.sendMessage({
        type: "FINISH_EXPANDED_CAPTURE", tabId: tab.id, windowId: tab.windowId,
        sessionId: expandedSession.sessionId,
      });
      if (!isBackgroundTranslationResponse(raw)) throw new Error("invalid-response");
      if (!raw.success) {
        setStatus({ kind: "error", message: translationPipelineErrorMessage(raw.error.code) });
        return;
      }
      setExpandedSession(null);
      setHasTranslations(true);
      setStatus({ kind: "success", message: `OCR detected ${raw.bubbleCount} text regions · Translation not enabled` });
    } catch {
      setStatus({ kind: "error", message: "Long-page OCR failed" });
    } finally {
      localTranslationTabId.current = null;
      setIsExpandedCaptureBusy(false);
    }
  }

  async function handleCancelExpandedCapture(): Promise<void> {
    if (!expandedSession) return;
    try {
      const tab = await getActiveTab();
      if (!tab.id) return;
      await chrome.runtime.sendMessage({
        type: "CANCEL_EXPANDED_CAPTURE", tabId: tab.id,
        sessionId: expandedSession.sessionId,
      });
    } finally {
      setExpandedSession(null);
      setStatus({ kind: "success", message: "Long-page capture cleared" });
    }
  }

  // ── Clear Markers ────────────────────────────────────────────
  async function handleClear(): Promise<void> {
    try {
      const tab = await getActiveTab();
      if (!tab.id) return;

      await chrome.tabs.sendMessage(
        tab.id,
        { type: "CLEAR_MARKERS" as const }
      );
      setHasMarkers(false);
      setHasTranslations(false);
      setIsTranslating(false);
      setIsLocalTranslating(false);
      setExpandedSession(null);
      setStatus(INITIAL_STATUS);
    } catch {
      // Page may have navigated away.
      setStatus(INITIAL_STATUS);
      setHasMarkers(false);
    }
  }

  // ── Status class helper ──────────────────────────────────────
  function statusClass(): string {
    return `status-text ${status.kind}`;
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <main className="reader-popup">
      <header className="popup-header">
        <div className="logo-mark">M</div>
        <div className="header-text">
          <h1>MangaLens</h1>
          <p>Chapter translator</p>
        </div>
        <span className="privacy-badge">Local-first</span>
      </header>

      <section className="reader-card" aria-label="Chapter reader">
        {readerSession?.active ? (
          <div className="chapter-summary">
            <span className="chapter-state">Chapter ready</span>
            <h2>{readerSession.title}</h2>
            <p>
              {readerSession.totalPages} page{readerSession.totalPages === 1 ? "" : "s"} detected
              {readerSession.translatedPages > 0
                ? ` · ${readerSession.translatedPages} translated`
                : ""}
            </p>
          </div>
        ) : (
          <div className="chapter-summary empty">
            <span className="chapter-state">Current tab</span>
            <h2>Translate the chapter you’re reading</h2>
            <p>MangaLens finds comic pages directly on the open website.</p>
          </div>
        )}

        <LanguageSelect
          label="Read in"
          value={targetLanguage}
          options={TARGET_LANGUAGE_OPTIONS}
          onChange={handleTargetChange}
        />

        {!readerSession?.active ? (
          <button
            className="btn btn-primary reader-primary"
            disabled={isScanning}
            onClick={handlePrepareChapter}
          >
            {isScanning ? "Finding chapter pages…" : "Prepare this chapter"}
          </button>
        ) : (
          <div className="reader-session-actions">
            <p className="engine-note">
              Chapter discovery is ready. Choose an engine in Advanced to process a page.
            </p>
            <label className="translation-toggle">
              <input type="checkbox" checked={translationsVisible}
                onChange={(event) => handleTranslationVisibility(event.target.checked)} />
              <span>Show translated text</span>
            </label>
            <button className="btn btn-secondary" disabled={isLocalTranslating}
              onClick={handleStopReaderSession}>
              End reader session
            </button>
          </div>
        )}
      </section>

      <section className="advanced-panel">
        <button className="advanced-toggle" type="button"
          aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
          <span>Advanced</span><span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
        </button>

        {advancedOpen && (
          <div className="advanced-content">
            <label className="engine-toggle">
              <span>
                <strong>Local AI processing</strong>
                <small>Private · requires Docker, Ollama, and a capable computer</small>
              </span>
              <input type="checkbox" checked={localAiEnabled}
                onChange={(event) => handleLocalAiSetting(event.target.checked)} />
            </label>

            <LanguageSelect label="Source language" value={sourceLanguage}
              options={SOURCE_LANGUAGE_OPTIONS} onChange={handleSourceChange} />

            {localAiEnabled && readerSession?.active && hasMarkers && (
              <div className="advanced-actions">
                <button className="btn btn-primary"
                  disabled={isScanning || isTranslating || isCapturing || isLocalTranslating}
                  onClick={() => handleLocalTranslation("development-api")}>
                  {isLocalTranslating && currentServiceMode === "development-api"
                    ? localStage === "capturing" ? "Capturing page…"
                      : localStage === "processing" ? "Running local AI…"
                        : "Applying text…"
                    : "Translate visible page locally"}
                </button>

                {!expandedSession ? (
                  <button className="btn btn-secondary"
                    disabled={isScanning || isCapturing || isLocalTranslating || isExpandedCaptureBusy}
                    onClick={handleStartExpandedCapture}>Long-page fallback</button>
                ) : (
                  <>
                    <button className="btn btn-primary" disabled={isExpandedCaptureBusy}
                      onClick={handleCaptureExpandedSegment}>
                      Capture segment ({expandedSession.segmentCount})
                    </button>
                    <button className="btn btn-primary"
                      disabled={isExpandedCaptureBusy || expandedSession.segmentCount === 0}
                      onClick={handleFinishExpandedCapture}>Finish long page</button>
                    <button className="btn btn-secondary" disabled={isExpandedCaptureBusy}
                      onClick={handleCancelExpandedCapture}>Cancel fallback</button>
                  </>
                )}
              </div>
            )}

            <details className="developer-tools">
              <summary>Developer diagnostics</summary>
              <div className="advanced-actions">
                <button className="btn btn-secondary" disabled={isScanning}
                  onClick={handleScan}>Legacy page scan</button>
                {hasMarkers && <button className="btn btn-secondary"
                  disabled={isTranslating} onClick={handlePreviewTranslation}>
                  {isTranslating ? "Running preview…" : "Deterministic preview"}
                </button>}
                {hasMarkers && <button className="btn btn-secondary"
                  disabled={isCapturing} onClick={handleTestCapture}>
                  {isCapturing ? "Testing capture…" : "Test capture"}
                </button>}
                {(hasTranslations || isTranslating) && <button className="btn btn-secondary"
                  onClick={handleClearTranslations}>Clear translated text</button>}
                {hasMarkers && <button className="btn btn-secondary"
                  onClick={handleClear}>Clear page state</button>}
              </div>
            </details>
          </div>
        )}
      </section>

      <div className="status-bar">
        <p className={statusClass()}>{status.message}</p>
      </div>
    </main>
  );
}
