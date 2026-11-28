/**
 * A small in-memory rate limiter. Enough for one web service process. On Render the service
 * usually has one instance; if you scale it out, each instance counts on its own.
 */

/**
 * @param {Object} options
 * @param {number} options.windowMs how long a window lasts
 * @param {number} options.max how many hits are allowed in one window
 * @returns {{ check: (key: string) => { ok: boolean, retryAfterSec: number } }}
 */
exports.createRateLimiter = ({ windowMs, max }) => {
  const hits = new Map();

  const prune = now => {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  };

  return {
    check(key) {
      const now = Date.now();
      prune(now);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfterSec: 0 };
      }
      entry.count += 1;
      if (entry.count > max) {
        return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
};
