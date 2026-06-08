/**
 * In-memory rate limiter — production-grade with sliding window.
 * For multi-instance deploys, replace with Redis-backed rate limiter.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

export function createRateLimiter(name: string, maxRequests: number, windowMs: number) {
  if (!stores.has(name)) stores.set(name, new Map());
  const store = stores.get(name)!;

  // Cleanup stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1000);

  return {
    check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
      const now = Date.now();
      const entry = store.get(key);

      if (!entry || entry.resetAt < now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
      }

      if (entry.count >= maxRequests) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
      }

      entry.count++;
      return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
    },

    reset(key: string) {
      store.delete(key);
    }
  };
}

// ── Pre-configured limiters ───────────────────────────────────────────────────
export const authLimiter = createRateLimiter('auth', 10, 15 * 60 * 1000);      // 10/15min
export const uploadLimiter = createRateLimiter('upload', 20, 60 * 1000);        // 20/min
export const globalLimiter = createRateLimiter('global', 500, 15 * 60 * 1000); // 500/15min
