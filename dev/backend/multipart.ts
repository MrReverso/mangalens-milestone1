import { Buffer } from "node:buffer";

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryStr = `--${boundary}`;
  const startBoundary = Buffer.from(`${boundaryStr}\r\n`);
  const delimiter = Buffer.from(`\r\n${boundaryStr}`);
  
  if (body.length < startBoundary.length || !body.subarray(0, startBoundary.length).equals(startBoundary)) {
    return [];
  }
  
  let partStart = startBoundary.length;
  
  while (true) {
    let searchStart = partStart;
    let delimMatchIndex = -1;
    let nextOffset = -1;
    let isEnd = false;
    
    while (true) {
      const idx = body.indexOf(delimiter, searchStart);
      if (idx === -1) {
        break;
      }
      
      const off = idx + delimiter.length;
      if (off + 2 <= body.length) {
        const suffix = body.subarray(off, off + 2);
        if (suffix.equals(Buffer.from("\r\n"))) {
          delimMatchIndex = idx;
          nextOffset = off;
          break;
        } else if (suffix.equals(Buffer.from("--"))) {
          if (off + 4 <= body.length) {
            const afterEnd = body.subarray(off + 2, off + 4);
            if (!afterEnd.equals(Buffer.from("\r\n"))) {
              searchStart = idx + 1;
              continue;
            }
          }
          delimMatchIndex = idx;
          nextOffset = off;
          isEnd = true;
          break;
        }
      }
      searchStart = idx + 1;
    }
    
    if (delimMatchIndex === -1) {
      break;
    }
    
    const partBuffer = body.subarray(partStart, delimMatchIndex);
    const headerEndIndex = partBuffer.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEndIndex !== -1) {
      const headersString = partBuffer.toString("utf8", 0, headerEndIndex);
      const data = partBuffer.subarray(headerEndIndex + 4);
      
      const nameMatch = headersString.match(/name="([^"]+)"/);
      if (nameMatch) {
        const name = nameMatch[1];
        const filenameMatch = headersString.match(/filename="([^"]+)"/);
        const filename = filenameMatch ? filenameMatch[1] : undefined;
        
        const contentTypeMatch = headersString.match(/Content-Type:\s*([^\r\n;]+)/i);
        const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : undefined;
        
        const headerLines = headersString.split("\r\n").filter(Boolean);
        const allHeadersValid = headerLines.every(line => line.includes(":"));
        
        if (allHeadersValid) {
          parts.push({
            name,
            filename,
            contentType,
            data,
          });
        }
      }
    }
    
    if (isEnd) {
      break;
    }
    
    partStart = nextOffset + 2;
  }
  
  return parts;
}
