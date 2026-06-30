export interface OperationSequenceStore {
  next(tabId: number): Promise<number>;
}

export class ChromeSessionSequenceStore implements OperationSequenceStore {
  async next(tabId: number): Promise<number> {
    const key = `mangalens.translationSequence.${tabId}`;
    try {
      const data = await chrome.storage.session.get(key);
      const val = data ? data[key] : undefined;
      let nextSeq = 1;
      if (typeof val === "number" && Number.isSafeInteger(val) && val > 0) {
        nextSeq = val + 1;
      }
      await chrome.storage.session.set({ [key]: nextSeq });
      return nextSeq;
    } catch (error) {
      throw new Error(
        `Failed to allocate sequence for tab ${tabId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
