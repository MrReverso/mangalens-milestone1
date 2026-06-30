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
} from "@/lib/messages";
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

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // Probe: if the content script is already injected, this succeeds.
    await chrome.tabs.sendMessage(tabId, { type: "GET_SCAN_STATUS" as const });
  } catch {
    // Content script not present — inject it.
    await chrome.scripting.executeScript({
      target: { tabId },
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

  // ── Load persisted settings on mount ─────────────────────────
  useEffect(() => {
    getSettings().then((settings) => {
      setSourceLanguage(settings.sourceLanguage);
      setTargetLanguage(settings.targetLanguage);
    });

    // Check if there's an active scan on the current tab.
    checkScanStatus();
  }, []);

  // ── Persist language changes ─────────────────────────────────
  const handleSourceChange = useCallback((value: string) => {
    const lang = value as SourceLanguage;
    setSourceLanguage(lang);
    saveSettings({ sourceLanguage: lang, targetLanguage });
  }, [targetLanguage]);

  const handleTargetChange = useCallback((value: string) => {
    const lang = value as TargetLanguage;
    setTargetLanguage(lang);
    saveSettings({ sourceLanguage, targetLanguage: lang });
  }, [sourceLanguage]);

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
  async function checkScanStatus(): Promise<void> {
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
        setStatus({ kind: "no-access", message: "This page cannot be accessed" });
        setIsScanning(false);
        return;
      }

      // Ensure the content script is injected before sending commands.
      await ensureContentScript(tab.id);

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
    } catch {
      setStatus({
        kind: "error",
        message: "An unexpected error occurred",
      });
    } finally {
      setIsScanning(false);
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
          className="btn btn-primary"
          disabled={isScanning}
          onClick={handleScan}
        >
          {isScanning ? "Scanning\u2026" : "Scan Manga Page"}
        </button>

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