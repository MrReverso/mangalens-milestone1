import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MangaLens',
    description: 'Manga Translator — detect and translate manga, manhwa, and webtoon pages directly on websites.',
    version: '0.1.0',
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['http://127.0.0.1:8787/*'],
    web_accessible_resources: [
      {
        resources: [
          'tesseract/worker.min.js',
          'tesseract/tesseract-core.wasm.js',
          'tesseract/tesseract-core.wasm',
          'tesseract/lang/*.traineddata',
        ],
        matches: ['<all_urls>'],
      },
    ],
  },
});