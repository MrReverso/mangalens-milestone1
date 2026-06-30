import { Buffer } from "node:buffer";

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  
  let index = 0;
  while (true) {
    const boundaryIndex = body.indexOf(boundaryBuffer, index);
    if (boundaryIndex === -1) break;
    
    // Check if next characters are "--", which means end boundary
    const nextBytes = body.subarray(
      boundaryIndex + boundaryBuffer.length,
      boundaryIndex + boundaryBuffer.length + 2
    );
    if (nextBytes.equals(Buffer.from("--"))) {
      break;
    }
    
    const nextLineIndex = body.indexOf(Buffer.from("\r\n"), boundaryIndex + boundaryBuffer.length);
    if (nextLineIndex === -1) break;
    
    const partStart = nextLineIndex + 2;
    const nextBoundaryIndex = body.indexOf(boundaryBuffer, partStart);
    if (nextBoundaryIndex === -1) break;
    
    const partEnd = nextBoundaryIndex - 2; // Subtract \r\n
    const partBuffer = body.subarray(partStart, partEnd);
    
    const headerEndIndex = partBuffer.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEndIndex === -1) {
      index = nextBoundaryIndex;
      continue;
    }
    
    const headersString = partBuffer.toString("utf8", 0, headerEndIndex);
    const data = partBuffer.subarray(headerEndIndex + 4);
    
    const nameMatch = headersString.match(/name="([^"]+)"/);
    if (!nameMatch) {
      index = nextBoundaryIndex;
      continue;
    }
    
    const name = nameMatch[1];
    const filenameMatch = headersString.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : undefined;
    
    const contentTypeMatch = headersString.match(/Content-Type:\s*([^\r\n;]+)/i);
    const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : undefined;
    
    parts.push({
      name,
      filename,
      contentType,
      data,
    });
    
    index = nextBoundaryIndex;
  }
  return parts;
}
