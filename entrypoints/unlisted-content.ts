import { MangaScannerController } from "@/lib/scanner-controller";

const CONTROLLER_KEY = "__mangalensScannerControllerV1";

type MangaLensGlobal = typeof globalThis & {
  [CONTROLLER_KEY]?: MangaScannerController;
};

export default defineUnlistedScript(() => {
  const pageGlobal = globalThis as MangaLensGlobal;
  if (pageGlobal[CONTROLLER_KEY]) return;

  const controller = new MangaScannerController();
  pageGlobal[CONTROLLER_KEY] = controller;
  controller.initialize();

  window.addEventListener("unload", () => {
    controller.destroy();
    delete pageGlobal[CONTROLLER_KEY];
  }, { once: true });
});
