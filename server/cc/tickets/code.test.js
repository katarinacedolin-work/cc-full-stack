const { makeCode, normalizeCode } = require('./code');

describe('ticket codes', () => {
  it('makes ten characters with none that look alike', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(makeCode()).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
    }
  });

  it('makes a different code each time', () => {
    const codes = new Set(Array.from({ length: 500 }, makeCode));
    expect(codes.size).toBe(500);
  });

  it('reads a code however it was typed', () => {
    expect(normalizeCode(' k7m3q x9rtb ')).toBe('K7M3QX9RTB');
    expect(normalizeCode('K7M3Q-X9RTB')).toBe('K7M3QX9RTB');
  });

  it('turns anything that is not a code into an empty string', () => {
    expect(normalizeCode('')).toBe('');
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode('K7M3QX9RT')).toBe('');
    expect(normalizeCode('K7M3QX9RTO')).toBe('');
    expect(normalizeCode("' or 1=1 --")).toBe('');
    expect(normalizeCode('https://example.com/K7M3QX9RTB')).toBe('');
  });
});
