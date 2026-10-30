export interface EnqueueOptions {
  priority?: boolean;
  maxRetries?: number;
}

export class RateLimitError extends Error {
  retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

type QueueTask<T> = {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  retriesLeft: number;
  priority: boolean;
};

export class RequestQueue {
  private priorityQueue: QueueTask<unknown>[] = [];
  private normalQueue: QueueTask<unknown>[] = [];
  private isProcessing = false;
  private baseDelayMs = 450;
  private pausedUntil = 0;

  // Sliding 60-second window for local burst prediction
  private recentTimestamps: number[] = [];
  private maxRequestsPerMinute = 54;

  // Server-reported rate limit state (x-ratelimit-remaining & x-ratelimit-reset)
  private rateLimitRemaining: number | null = null;
  private rateLimitResetAt = 0;

  constructor(options?: { baseDelayMs?: number; maxRequestsPerMinute?: number }) {
    if (options?.baseDelayMs !== undefined) this.baseDelayMs = options.baseDelayMs;
    if (options?.maxRequestsPerMinute !== undefined) this.maxRequestsPerMinute = options.maxRequestsPerMinute;
  }

  /**
   * Reads Reddit / Fastly rate-limit headers from any fetch Response
   * so we can predict and pace requests before hitting a 429 penalty.
   */
  updateFromResponse(res: { headers?: { get?: (name: string) => string | null } } | null | undefined, now = Date.now()): void {
    if (!res?.headers || typeof res.headers.get !== 'function') return;

    const remainingRaw = res.headers.get('x-ratelimit-remaining');
    const resetRaw = res.headers.get('x-ratelimit-reset');

    if (remainingRaw !== null) {
      const parsedRem = parseFloat(remainingRaw);
      if (!Number.isNaN(parsedRem)) {
        this.rateLimitRemaining = parsedRem;
      }
    }

    if (resetRaw !== null) {
      const parsedResetSec = parseFloat(resetRaw);
      if (!Number.isNaN(parsedResetSec) && parsedResetSec > 0) {
        this.rateLimitResetAt = now + parsedResetSec * 1000;
      }
    }
  }

  /**
   * Builds a RateLimitError from a 429 response, extracting Retry-After or x-ratelimit-reset if available.
   */
  createRateLimitError(
    res: { headers?: { get?: (name: string) => string | null } } | null | undefined,
    message: string,
    now = Date.now()
  ): RateLimitError {
    this.updateFromResponse(res, now);
    let retryAfterMs: number | undefined;

    if (res?.headers && typeof res.headers.get === 'function') {
      const retryAfterRaw = res.headers.get('retry-after');
      if (retryAfterRaw !== null) {
        const parsedSec = parseFloat(retryAfterRaw);
        if (!Number.isNaN(parsedSec) && parsedSec > 0) {
          retryAfterMs = parsedSec * 1000;
        }
      }
      if (retryAfterMs === undefined && this.rateLimitResetAt > now) {
        retryAfterMs = this.rateLimitResetAt - now;
      }
    }

    return new RateLimitError(message, retryAfterMs);
  }

  /**
   * Calculates whether we should pre-emptively wait before firing the next request
   * to avoid triggering a hard HTTP 429 penalty.
   */
  getPredictiveWaitMs(now = Date.now()): number {
    if (now < this.pausedUntil) {
      return this.pausedUntil - now;
    }

    // 1. Check server-reported quota bucket: if <= 1 request left in window, wait for reset
    if (this.rateLimitRemaining !== null && now < this.rateLimitResetAt && this.rateLimitRemaining <= 1) {
      return Math.min(this.rateLimitResetAt - now, 15000);
    }

    // 2. Check local 60s sliding burst window
    this.pruneRecentTimestamps(now);
    if (this.recentTimestamps.length >= this.maxRequestsPerMinute) {
      const oldest = this.recentTimestamps[0];
      const waitForWindow = oldest + 60000 - now + 50;
      if (waitForWindow > 0) {
        return Math.min(waitForWindow, 10000);
      }
    }

    return 0;
  }

  /**
   * Computes adaptive pacing delay between requests based on remaining quota and recent burst velocity.
   */
  getAdaptiveDelayMs(now = Date.now()): number {
    this.pruneRecentTimestamps(now);

    // If server headers report low remaining quota (< 15), spread remaining calls across reset window
    if (
      this.rateLimitRemaining !== null &&
      now < this.rateLimitResetAt &&
      this.rateLimitRemaining > 1 &&
      this.rateLimitRemaining <= 15
    ) {
      const windowRemainingMs = this.rateLimitResetAt - now;
      const idealSpacing = Math.ceil(windowRemainingMs / (this.rateLimitRemaining + 1));
      return Math.min(2500, Math.max(this.baseDelayMs, idealSpacing));
    }

    const recentCount = this.recentTimestamps.length;
    if (recentCount < 20) {
      return this.baseDelayMs;
    }
    if (recentCount < 40) {
      return Math.max(this.baseDelayMs, 650);
    }
    return Math.max(this.baseDelayMs, 950);
  }

  private pruneRecentTimestamps(now: number): void {
    const cutoff = now - 60000;
    while (this.recentTimestamps.length > 0 && this.recentTimestamps[0] <= cutoff) {
      this.recentTimestamps.shift();
    }
  }

  async enqueue<T>(task: () => Promise<T>, options: EnqueueOptions = {}): Promise<T> {
    const priority = Boolean(options.priority);
    const maxRetries = options.maxRetries ?? 2;

    return new Promise<T>((resolve, reject) => {
      const item: QueueTask<unknown> = {
        execute: task as () => Promise<unknown>,
        resolve: resolve as (val: unknown) => void,
        reject,
        retriesLeft: maxRetries,
        priority
      };

      if (priority) {
        this.priorityQueue.push(item);
      } else {
        this.normalQueue.push(item);
      }
      void this.processQueue();
    });
  }

  private nextTask(): QueueTask<unknown> | undefined {
    if (this.priorityQueue.length > 0) {
      return this.priorityQueue.shift();
    }
    return this.normalQueue.shift();
  }

  private hasPendingTasks(): boolean {
    return this.priorityQueue.length > 0 || this.normalQueue.length > 0;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.hasPendingTasks()) {
      const waitMs = this.getPredictiveWaitMs(Date.now());
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const task = this.nextTask();
      if (!task) break;

      try {
        this.recentTimestamps.push(Date.now());
        const result = await task.execute();
        task.resolve(result);
      } catch (err: unknown) {
        const is429 =
          err instanceof RateLimitError ||
          (err instanceof Error && err.message.includes('429'));

        if (is429) {
          const rawCooldown = err instanceof RateLimitError && err.retryAfterMs ? err.retryAfterMs : 10000;
          const cooldownMs = Math.min(30000, Math.max(2000, rawCooldown));
          console.warn(
            `[BotDeflector] Rate limited (429). Pausing queue for ${Math.round(cooldownMs / 1000)}s (retries left: ${task.retriesLeft})...`
          );
          this.pausedUntil = Date.now() + cooldownMs;

          if (task.retriesLeft > 0) {
            task.retriesLeft -= 1;
            // Re-queue at the very front so this user is not dropped after cooldown
            this.priorityQueue.unshift(task);
            continue;
          }
        }
        task.reject(err);
      }

      if (this.hasPendingTasks()) {
        const delay = this.getAdaptiveDelayMs(Date.now());
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    this.isProcessing = false;
  }
}

export const requestQueue = new RequestQueue();
