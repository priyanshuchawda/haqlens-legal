export type RateLimitResult = Readonly<{ allowed: boolean; retryAfterSeconds: number }>;

type Entry = { count: number; resetAt: number };

export type RateLimiter = Readonly<{ consume(clientKey: string): RateLimitResult }>;

export function createRateLimiter(
  options: Readonly<{
    limit: number;
    maxEntries: number;
    now: () => number;
    windowMs: number;
  }>,
): RateLimiter {
  const entries = new Map<string, Entry>();

  return {
    consume(clientKey) {
      const now = options.now();

      for (const [key, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(key);
      }

      const current = entries.get(clientKey);
      if (current !== undefined) {
        if (current.count >= options.limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
          };
        }
        current.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (entries.size >= options.maxEntries) return { allowed: false, retryAfterSeconds: 1 };
      entries.set(clientKey, { count: 1, resetAt: now + options.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
