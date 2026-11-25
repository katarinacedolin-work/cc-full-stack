const { createRateLimiter } = require('./rateLimit');

describe('createRateLimiter', () => {
  it('allows up to max hits in a window', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
  });

  it('counts keys separately', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
  });
});
