interface QueueTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export class ApiRateLimiter {
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private activeCount = 0;
  private lastDispatchedAt = 0;
  private readonly queue: Array<QueueTask<unknown>> = [];

  constructor(options: { maxConcurrent: number; minIntervalMs: number }) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent);
    this.minIntervalMs = Math.max(0, options.minIntervalMs);
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const now = Date.now();
      const waitMs = Math.max(0, this.lastDispatchedAt + this.minIntervalMs - now);

      if (waitMs > 0) {
        setTimeout(() => this.pump(), waitMs);
        return;
      }

      const next = this.queue.shift();
      if (!next) return;

      this.activeCount += 1;
      this.lastDispatchedAt = Date.now();

      next
        .fn()
        .then((res) => next.resolve(res))
        .catch((err) => next.reject(err))
        .finally(() => {
          this.activeCount -= 1;
          this.pump();
        });
    }
  }
}

// High-parallelism limiters so FI, SV, and RU batches execute concurrently without artificial lag
export const limiters = {
  mediawiki: new ApiRateLimiter({ maxConcurrent: 10, minIntervalMs: 0 }),
  wikidata: new ApiRateLimiter({ maxConcurrent: 6, minIntervalMs: 0 }),
  pageviews: new ApiRateLimiter({ maxConcurrent: 10, minIntervalMs: 0 }),
  academic: new ApiRateLimiter({ maxConcurrent: 6, minIntervalMs: 50 }),
  linkCheck: new ApiRateLimiter({ maxConcurrent: 6, minIntervalMs: 25 }),
};

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxRetries?: number; limiter?: ApiRateLimiter } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 6500;
  const maxRetries = options.maxRetries ?? 1;

  const attemptFetch = async (): Promise<Response> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }

        return res;
      } catch (err) {
        if (attempt >= maxRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 200));
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`Request failed for ${url}`);
  };

  if (options.limiter) {
    return options.limiter.schedule(attemptFetch);
  }
  return attemptFetch();
}
