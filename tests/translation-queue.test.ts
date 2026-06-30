import { describe, expect, it, vi } from "vitest";
import { TranslationQueue } from "@/lib/translation-queue";

describe("TranslationQueue", () => {
  it("never queues the same page twice", () => {
    const queue = new TranslationQueue<void>();
    let resolveJob: (() => void) | undefined;
    const job = {
      pageId: "page-1",
      run: () => new Promise<void>((resolve) => { resolveJob = resolve; }),
      onStart: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
    expect(queue.enqueue(job)).toBe(true);
    expect(queue.enqueue(job)).toBe(false);
    resolveJob?.();
  });

  it("processes only one page at a time", async () => {
    const queue = new TranslationQueue<string>();
    const resolvers: Array<(value: string) => void> = [];
    let active = 0;
    let maximumActive = 0;
    const makeJob = (pageId: string) => ({
      pageId,
      run: () => new Promise<string>((resolve) => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        resolvers.push((value) => {
          active--;
          resolve(value);
        });
      }),
      onStart: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    });
    queue.enqueue(makeJob("page-1"));
    queue.enqueue(makeJob("page-2"));
    expect(resolvers).toHaveLength(1);
    resolvers[0]("one");
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]("two");
    expect(maximumActive).toBe(1);
  });

  it("aborts active work and removes queued work on clear", () => {
    const queue = new TranslationQueue<void>();
    let signal: AbortSignal | undefined;
    queue.enqueue({
      pageId: "page-1",
      run: (value) => {
        signal = value;
        return new Promise<void>(() => undefined);
      },
      onStart: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    });
    queue.enqueue({
      pageId: "page-2",
      run: () => Promise.resolve(),
      onStart: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    });
    queue.clear();
    expect(signal?.aborted).toBe(true);
    expect(queue.queuedCount).toBe(0);
  });
});
