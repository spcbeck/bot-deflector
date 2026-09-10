type QueueTask<T> = {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export class RequestQueue {
  private queue: QueueTask<unknown>[] = [];
  private isProcessing = false;
  private delayMs = 600;
  private pausedUntil = 0;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: task as () => Promise<unknown>,
        resolve: resolve as (val: unknown) => void,
        reject
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      if (now < this.pausedUntil) {
        const waitTime = this.pausedUntil - now;
        await new Promise((r) => setTimeout(r, waitTime));
      }

      const task = this.queue.shift();
      if (!task) break;

      try {
        const result = await task.execute();
        task.resolve(result);
      } catch (err: unknown) {
        // If HTTP 429 rate limited, backoff for 12 seconds
        if (err instanceof Error && err.message.includes('429')) {
          console.warn('[BotDeflector] Rate limited (429). Pausing queue for 12s...');
          this.pausedUntil = Date.now() + 12000;
        }
        task.reject(err);
      }

      // Respect request pacing
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    this.isProcessing = false;
  }
}

export const requestQueue = new RequestQueue();
