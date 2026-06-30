import { LocalOcrTranslationService } from '@/lib/translation/local-ocr-translation-service';

function dataURLtoBlob(dataurl: string): Blob {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

const activeControllers = new Map<string, AbortController>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen-ocr') return;

  const { action, requestId } = message;

  if (action === 'abort') {
    const controller = activeControllers.get(requestId);
    if (controller) {
      controller.abort();
      activeControllers.delete(requestId);
    }
    sendResponse({ success: true });
    return;
  }

  if (action === 'scan') {
    const { imageBase64, metadata } = message;

    const controller = new AbortController();
    activeControllers.set(requestId, controller);

    const service = new LocalOcrTranslationService(0);
    const blob = dataURLtoBlob(imageBase64);

    service.translate({ image: blob, metadata }, controller.signal)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message || String(error) });
      })
      .finally(() => {
        activeControllers.delete(requestId);
      });

    return true; // async response
  }
});
