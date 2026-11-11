/** Pembatas laju jendela-tetap di memori. (Beberapa instance server: ganti dengan Redis/gateway.) */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** true = diizinkan. */
  take(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
    const t = this.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset <= t) this.hits.delete(k);
    let h = this.hits.get(key);
    if (!h || h.reset <= t) { h = { n: 0, reset: t + windowMs }; this.hits.set(key, h); }
    h.n++;
    return { ok: h.n <= limit, retryAfterSec: Math.max(1, Math.ceil((h.reset - t) / 1000)) };
  }
}
