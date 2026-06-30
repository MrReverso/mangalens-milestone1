import { useState, useEffect, useCallback } from "react";
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
} from "@/lib/messages";
import type { CaptureErrorCode } from "@/types/capture";
import { isBackgroundCaptureResponse } from "@/types/capture";
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
  message: "Ready to scan",
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

  // ── Load persisted settings on mount ─────────────────────────
  useEffect(() => {
    getSettings().then((settings) => {
      setSourceLanguage(settings.sourceLanguage);
      setTargetLanguage(settings.targetLanguage);
      setTranslationsVisible(settings.translationsVisible);
      checkScanStatus(settings.translationsVisible);
    });
  }, []);

  // ── Persist language changes ─────────────────────────────────
  const handleSourceChange = useCallback((value: string) => {
    const lang = value as SourceLanguage;
    setSourceLanguage(lang);
    saveSettings({ sourceLanguage: lang, targetLanguage, translationsVisible });
  }, [targetLanguage, translationsVisible]);

  const handleTargetChange = useCallback((value: string) => {
    const lang = value as TargetLanguage;
    setTargetLanguage(lang);
    saveSettings({ sourceLanguage, targetLanguage: lang, translationsVisible });
  }, [sourceLanguage, translationsVisible]);

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
    await saveSettings({ sourceLanguage, targetLanguage, translationsVisible: visible });
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

  function captureErrorMessage(code: CaptureErrorCode): string {
    switch (code) {
      case "no-detected-pages":
        return "Scan the page first";
      case "no-fully-visible-page":
        return "Scroll until one complete manga page is visible";
      case "capture-in-progress":
        return "A capture is already running";
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
    <>
      <header className="popup-header">
        <div className="logo-mark">M</div>
        <div className="header-text">
          <h1>MangaLens</h1>
          <p>Manga Translator</p>
        </div>
      </header>

      <div className="divider" />

      <section className="popup-controls">
        <LanguageSelect
          label="Source Language"
          value={sourceLanguage}
          options={SOURCE_LANGUAGE_OPTIONS}
          onChange={handleSourceChange}
        />
        <LanguageSelect
          label="Target Language"
          value={targetLanguage}
          options={TARGET_LANGUAGE_OPTIONS}
          onChange={handleTargetChange}
        />
      </section>

      <section className="popup-actions">
        <button
          className={`btn ${hasMarkers ? "btn-secondary" : "btn-primary"}`}
          disabled={isScanning || isCapturing}
          onClick={handleScan}
        >
          {isScanning ? "Scanning\u2026" : "Scan Manga Page"}
        </button>

        {hasMarkers && (
          <button
            className="btn btn-primary"
            disabled={isTranslating || isCapturing}
            onClick={handlePreviewTranslation}
          >
            {isTranslating ? "Translating\u2026" : "Preview Translation"}
          </button>
        )}

        {hasMarkers && (
          <button
            className="btn btn-secondary"
            disabled={isScanning || isTranslating || isCapturing}
            onClick={handleTestCapture}
          >
            {isCapturing ? "Capturing\u2026" : "Test Image Capture"}
          </button>
        )}

        {hasMarkers && (
          <label className="translation-toggle">
            <input
              type="checkbox"
              checked={translationsVisible}
              onChange={(event) =>
                handleTranslationVisibility(event.target.checked)}
            />
            <span>Show translations</span>
          </label>
        )}

        {(hasTranslations || isTranslating) && (
          <button
            className="btn btn-secondary"
            onClick={handleClearTranslations}
          >
            Clear Translations
          </button>
        )}

        {hasMarkers && (
          <button
            className="btn btn-secondary"
            onClick={handleClear}
          >
            Clear Page Markers
          </button>
        )}
      </section>

      <div className="status-bar">
        <p className={statusClass()}>{status.message}</p>
      </div>
    </>
  );
}
