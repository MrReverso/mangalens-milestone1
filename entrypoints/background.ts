// ── Background Service Worker ──────────────────────────────────
// Minimal Manifest V3 background script for MangaLens Milestone 1.
// Handles first-install initialization only.

import { initializeDefaultSettings } from "@/lib/storage";

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      await initializeDefaultSettings();
    }
  });
});