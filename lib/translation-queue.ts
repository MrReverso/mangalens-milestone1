export interface TranslationJob<T> {
  readonly pageId: string;
  readonly run: (signal: AbortSignal) => Promise<T>;
  readonly onStart: () => void;
  readonly onComplete: (result: T) => void;
  readonly onError: (error: Error) => void;
}

export class TranslationQueue<T> {
  private readonly queued: TranslationJob<T>[] = [];
  private readonly knownPageIds = new Set<string>();
  private active: {
    job: TranslationJob<T>;
    controller: AbortController;
  } | null = null;

  enqueue(job: TranslationJob<T>): boolean {
    if (this.knownPageIds.has(job.pageId)) return false;
    this.knownPageIds.add(job.pageId);
    this.queued.push(job);
    this.processNext();
    return true;
  }

  cancel(pageId: string): void {
    const index = this.queued.findIndex((job) => job.pageId === pageId);
    if (index >= 0) {
      this.queued.splice(index, 1);
      this.knownPageIds.delete(pageId);
    }
    if (this.active?.job.pageId === pageId) {
      this.active.controller.abort();
    }
  }

  clear(): void {
    this.queued.length = 0;
    this.knownPageIds.clear();
    this.active?.controller.abort();
  }

  get queuedCount(): number {
    return this.queued.length;
  }

  get activeCount(): number {
    return this.active ? 1 : 0;
  }

  private processNext(): void {
    if (this.active || this.queued.length === 0) return;
    const job = this.queued.shift();
    if (!job) return;
    const controller = new AbortController();
    const active = { job, controller };
    this.active = active;
    job.onStart();

    job.run(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) job.onComplete(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          job.onError(error instanceof Error ? error : new Error("Translation failed"));
        }
      })
      .finally(() => {
        if (this.active === active) this.active = null;
        const stillScheduled = this.active?.job.pageId === job.pageId ||
          this.queued.some((queuedJob) => queuedJob.pageId === job.pageId);
        if (!stillScheduled) this.knownPageIds.delete(job.pageId);
        this.processNext();
      });
  }
}
