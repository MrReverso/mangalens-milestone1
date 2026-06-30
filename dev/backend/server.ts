import { createServer } from "node:http";
import { handleTranslationRequest } from "./translation-handler";

const PORT = 8787;
const HOST = "127.0.0.1";

const server = createServer((req, res) => {
  const timestamp = new Date().toISOString();
  const pathname = (req.url || "").split("?")[0];
  const method = req.method || "";

  try {
    handleTranslationRequest(req, res).catch(() => {
      console.error(`[${timestamp}] ${method} ${pathname} 500 - Request failed`);
      if (!res.writableEnded) {
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify({ success: false, error: { code: "internal-server-error" } }));
      }
    });
  } catch {
    console.error(`[${timestamp}] ${method} ${pathname} 500 - Server exception`);
    if (!res.writableEnded) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify({ success: false, error: { code: "internal-server-error" } }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MangaLens development API listening on http://${HOST}:${PORT}`);
});
