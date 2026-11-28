const { isSdsuEmail, normalizeEmail } = require('./sdsu');

describe('isSdsuEmail', () => {
  it('accepts @sdsu.edu addresses', () => {
    expect(isSdsuEmail('student@sdsu.edu')).toBe(true);
    expect(isSdsuEmail('  Student@SDSU.EDU  ')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isSdsuEmail('student@gmail.com')).toBe(false);
    expect(isSdsuEmail('student@mail.sdsu.edu')).toBe(false);
    expect(isSdsuEmail('@sdsu.edu')).toBe(false);
    expect(isSdsuEmail('sdsu.edu')).toBe(false);
    expect(isSdsuEmail('')).toBe(false);
    expect(isSdsuEmail(null)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Student@SDSU.EDU ')).toBe('student@sdsu.edu');
  });
});
