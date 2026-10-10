import { parseDemoAnchor, resolveDemoAnchor } from './demo-anchor';

describe('parseDemoAnchor', () => {
  it('reads YYYY-MM-DD as 09:00 UTC on that calendar day', () => {
    expect(parseDemoAnchor('2026-10-10')).toBe(Date.UTC(2026, 9, 10, 9));
    expect(parseDemoAnchor('2028-02-29')).toBe(Date.UTC(2028, 1, 29, 9));
  });

  it.each(['', 'today', '2026-1-1', '2026-10-10T09:00', '2026-13-01', '2026-02-30', '2026-00-10'])(
    'rejects %p',
    (text) => {
      expect(parseDemoAnchor(text)).toBeUndefined();
    },
  );
});

describe('resolveDemoAnchor', () => {
  // A local evening and a local morning of one calendar day must name the same anchor.
  const lateEvening = new Date(2026, 9, 10, 23, 59);
  const earlyMorning = new Date(2026, 9, 10, 0, 1);

  it('uses the local calendar day of now when no override is given', () => {
    expect(resolveDemoAnchor(undefined, lateEvening)).toBe(Date.UTC(2026, 9, 10, 9));
    expect(resolveDemoAnchor(undefined, earlyMorning)).toBe(Date.UTC(2026, 9, 10, 9));
    expect(resolveDemoAnchor('', lateEvening)).toBe(Date.UTC(2026, 9, 10, 9));
  });

  it('uses the override day instead of now', () => {
    expect(resolveDemoAnchor('2026-09-10', lateEvening)).toBe(Date.UTC(2026, 8, 10, 9));
  });

  it('refuses a malformed override instead of quietly falling back to now', () => {
    expect(() => resolveDemoAnchor('10.10.2026', lateEvening)).toThrow(
      'KIKO_DEMO_ANCHOR must be a calendar day written YYYY-MM-DD, got "10.10.2026"',
    );
  });
});
