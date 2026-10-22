/**
 * In-memory sliding-window limiter. Enough for a single-process install; counts reset
 * when the server restarts.
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return function allow(key: string, now: number = Date.now()): boolean {
    if (hits.size > 10_000) {
      for (const [k, times] of hits) {
        if (times.every((time) => time <= now - windowMs)) hits.delete(k);
      }
    }
    const recent = (hits.get(key) ?? []).filter((time) => time > now - windowMs);
    const allowed = recent.length < max;
    if (allowed) recent.push(now);
    hits.set(key, recent);
    return allowed;
  };
}
