import {
  CaptureCoordinator,
  createBackgroundCaptureMessageHandler,
} from "@/lib/capture/capture-coordinator";
import { BrowserScreenshotCropper } from "@/lib/capture/screenshot-cropper";
import { initializeDefaultSettings } from "@/lib/storage";
import { LocalOcrTranslationService } from "@/lib/translation/local-ocr-translation-service";
import {
  TranslationCoordinator,
  createBackgroundTranslationMessageHandler,
} from "@/lib/translation/translation-coordinator";
import { ChromeSessionSequenceStore } from "@/lib/translation/operation-sequence-store";

import { HttpTranslationService } from "@/lib/translation/http-translation-service";

const DEV_TRANSLATION_API_URL = "http://127.0.0.1:8787/v1/translate";

export default defineBackground(() => {
  let translationCoordinator: TranslationCoordinator | null = null;
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
    isTabReserved: (tabId) =>
      translationCoordinator?.isActive(tabId) ?? false,
  });
  const sequenceStore = new ChromeSessionSequenceStore();
  translationCoordinator = new TranslationCoordinator({
    captureImage: (request, signal) =>
      coordinator.captureImageForInternalUse(request, signal),
    services: {
      "local-demo": new LocalOcrTranslationService(),
      "development-api": new HttpTranslationService({
        endpoint: DEV_TRANSLATION_API_URL,
        fetchImpl: fetch,
        maxResponseBytes: 256 * 1024,
      }),
    },
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    nextOperationSequence: (tabId) => sequenceStore.next(tabId),
    reportStage: (tabId, stage) => {
      chrome.runtime.sendMessage({
        type: "TRANSLATION_PIPELINE_PROGRESS",
        tabId,
        stage,
      }).catch(() => undefined);
    },
    isCaptureActive: (tabId) => coordinator.isActive(tabId),
  });

  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      await initializeDefaultSettings();
    }
  });

  chrome.runtime.onMessage.addListener(
    createBackgroundCaptureMessageHandler(coordinator)
  );
  chrome.runtime.onMessage.addListener(
    createBackgroundTranslationMessageHandler(translationCoordinator)
  );
});
