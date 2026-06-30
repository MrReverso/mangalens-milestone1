import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeSessionSequenceStore } from "@/lib/translation/operation-sequence-store";

describe("ChromeSessionSequenceStore", () => {
  let mockSessionStore: Record<string, any>;

  beforeEach(() => {
    mockSessionStore = {};
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async (keys: string | string[]) => {
            const result: Record<string, any> = {};
            if (typeof keys === "string") {
              result[keys] = mockSessionStore[keys];
            } else if (Array.isArray(keys)) {
              for (const k of keys) {
                result[k] = mockSessionStore[k];
              }
            } else if (typeof keys === "object" && keys !== null) {
              // Handle object query format if any
              for (const k of Object.keys(keys)) {
                result[k] = mockSessionStore[k] ?? keys[k];
              }
            } else {
              // Return all if empty/undefined
              Object.assign(result, mockSessionStore);
            }
            return result;
          }),
          set: vi.fn(async (items: Record<string, any>) => {
            Object.assign(mockSessionStore, items);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("allocates sequence 1 when no previous value exists", async () => {
    const store = new ChromeSessionSequenceStore();
    const seq = await store.next(42);
    expect(seq).toBe(1);
    expect(mockSessionStore["mangalens.translationSequence.42"]).toBe(1);
  });

  it("increments sequence counter correctly", async () => {
    const store = new ChromeSessionSequenceStore();
    await store.next(42);
    const seq = await store.next(42);
    expect(seq).toBe(2);
    expect(mockSessionStore["mangalens.translationSequence.42"]).toBe(2);
  });

  it("keeps counters independent for different tabs", async () => {
    const store = new ChromeSessionSequenceStore();
    const seqTab1 = await store.next(1);
    const seqTab2 = await store.next(2);
    expect(seqTab1).toBe(1);
    expect(seqTab2).toBe(1);

    const seqTab1Next = await store.next(1);
    expect(seqTab1Next).toBe(2);
    expect(await store.next(2)).toBe(2);
  });

  it("recovers from invalid, negative, or non-finite stored values by falling back to 1", async () => {
    const store = new ChromeSessionSequenceStore();
    const key = "mangalens.translationSequence.42";

    mockSessionStore[key] = Infinity;
    expect(await store.next(42)).toBe(1);

    mockSessionStore[key] = -5;
    expect(await store.next(42)).toBe(1);

    mockSessionStore[key] = "invalid";
    expect(await store.next(42)).toBe(1);
  });

  it("rejects safely when storage access throws an error", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn().mockRejectedValue(new Error("Storage blocked")),
          set: vi.fn(),
        },
      },
    });

    const store = new ChromeSessionSequenceStore();
    await expect(store.next(42)).rejects.toThrow("Storage blocked");
  });
});
