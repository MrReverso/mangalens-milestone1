import {
  CaptureCoordinator,
  createBackgroundCaptureMessageHandler,
} from "@/lib/capture/capture-coordinator";
import { BrowserScreenshotCropper } from "@/lib/capture/screenshot-cropper";
import { initializeDefaultSettings } from "@/lib/storage";

export default defineBackground(() => {
  const coordinator = new CaptureCoordinator({
    isTabActive: async (tabId, windowId) => {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      return tabs.some((tab) => tab.id === tabId);
    },
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    captureVisibleTab: (windowId) => chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    }),
    cropper: new BrowserScreenshotCropper(),
  });

  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      await initializeDefaultSettings();
    }
  });

  chrome.runtime.onMessage.addListener(
    createBackgroundCaptureMessageHandler(coordinator)
  );
});
