import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rate-limit';

describe('bounded rate limiter', () => {
  test.each([
    { limit: 0, maxEntries: 1, windowMs: 1 },
    { limit: 1, maxEntries: 0, windowMs: 1 },
    { limit: 1, maxEntries: 1, windowMs: 0 },
    { limit: Number.MAX_SAFE_INTEGER + 1, maxEntries: 1, windowMs: 1 },
  ])('rejects invalid configuration %#', (options) => {
    expect(() => createRateLimiter({ ...options, now: () => 0 })).toThrow(RangeError);
  });

  test('allows a fixed number of requests then resets without sleeping', () => {
    let now = 1_000;
    const limiter = createRateLimiter({
      limit: 2,
      maxEntries: 2,
      now: () => now,
      windowMs: 10_000,
    });
    expect(limiter.consume('peer-a')).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume('peer-a')).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume('peer-a')).toEqual({ allowed: false, retryAfterSeconds: 10 });
    now += 10_000;
    expect(limiter.consume('peer-a')).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  test('bounds unique peer state by failing closed when full', () => {
    const limiter = createRateLimiter({
      limit: 1,
      maxEntries: 1,
      now: () => 1_000,
      windowMs: 10_000,
    });
    expect(limiter.consume('peer-a').allowed).toBe(true);
    expect(limiter.consume('peer-b')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});
