import { describe, expect, it } from "vitest";
import {
  isContentScriptMessage,
  isReaderSessionCommandResponse,
  isReaderSessionStatusResponse,
} from "@/lib/messages";

const status = {
  type: "READER_SESSION_STATUS",
  active: true,
  title: "Chapter 7",
  url: "https://reader.example/chapter/7",
  totalPages: 12,
  currentPage: 2,
  translatedPages: 3,
  failedPages: 0,
} as const;

describe("reader session messages", () => {
  it("accepts only the allowlisted reader commands", () => {
    expect(isContentScriptMessage({ type: "START_READER_SESSION" })).toBe(true);
    expect(isContentScriptMessage({ type: "GET_READER_SESSION_STATUS" })).toBe(true);
    expect(isContentScriptMessage({ type: "STOP_READER_SESSION" })).toBe(true);
    expect(isContentScriptMessage({ type: "START_READER_SESSION_NOW" })).toBe(false);
  });

  it("validates status and command responses strictly", () => {
    expect(isReaderSessionStatusResponse(status)).toBe(true);
    expect(isReaderSessionCommandResponse({ success: true, status })).toBe(true);
    expect(isReaderSessionStatusResponse({ ...status, totalPages: -1 })).toBe(false);
    expect(isReaderSessionStatusResponse({ ...status, extra: true })).toBe(false);
    expect(isReaderSessionCommandResponse({ success: true, status, extra: true }))
      .toBe(false);
  });
});
