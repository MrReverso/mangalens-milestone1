import { createServer } from "node:http";
import { handleTranslationRequest } from "./translation-handler";

const PORT = 8787;
const HOST = "127.0.0.1";

const server = createServer((req, res) => {
  try {
    handleTranslationRequest(req, res).catch((error) => {
      // Minimal logging for server requests
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] Request handling failed: ${error.message}`);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: { code: "internal-server-error" } }));
      }
    });
  } catch (error: any) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] Exception: ${error.message}`);
    if (!res.writableEnded) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "internal-server-error" } }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MangaLens development API listening on http://${HOST}:${PORT}`);
});
