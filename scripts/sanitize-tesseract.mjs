import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tesseractDir = path.resolve(__dirname, "../public/tesseract");

const files = [
  "tesseract.esm.min.js",
  "worker.min.js"
];

for (const file of files) {
  const filePath = path.join(tesseractDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, "utf-8");
    // Replace jsdelivr.net with local-only.invalid
    content = content.replace(/jsdelivr\.net/g, "local-only.invalid");
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`Sanitized ${file}`);
  }
}
