import { defaultDateRange } from './default-range';

describe('defaultDateRange', () => {
  it('sets `to` to the injected `now`', () => {
    const now = new Date(2026, 8, 6, 15, 30).getTime();

    const range = defaultDateRange(now);

    expect(range.to.getTime()).toBe(now);
  });

  it('sets `from` to the start of the local day 30 days before `now`', () => {
    const now = new Date(2026, 8, 6, 15, 30).getTime();

    const range = defaultDateRange(now);

    expect(range.from.getTime()).toBe(new Date(2026, 7, 7, 0, 0, 0, 0).getTime());
  });

  it('is pure: the same `now` input always yields the same output', () => {
    const now = new Date(2026, 8, 6, 15, 30).getTime();

    const first = defaultDateRange(now);
    const second = defaultDateRange(now);

    expect(first).toEqual(second);
  });

  it('defaults `now` to Date.now() when no argument is given', () => {
    const before = Date.now();

    const range = defaultDateRange();

    const after = Date.now();
    expect(range.to.getTime()).toBeGreaterThanOrEqual(before);
    expect(range.to.getTime()).toBeLessThanOrEqual(after);
  });
});

// Europe/Kyiv (pinned in jest.config.js) springs forward on 2026-03-29 and
// falls back on 2026-10-25, so each spring and autumn `now` below has a 23- or
// 25-hour day inside its 30-day window.
describe('defaultDateRange across DST and the year boundary', () => {
  it.each([
    ['spring, `now` at 00:30', new Date(2026, 3, 1, 0, 30), new Date(2026, 2, 2)],
    ['spring, `now` at midnight', new Date(2026, 2, 30, 0, 0), new Date(2026, 1, 28)],
    ['autumn, `now` at 23:30', new Date(2026, 9, 26, 23, 30), new Date(2026, 8, 26)],
    ['year wrap', new Date(2027, 0, 15, 12, 0), new Date(2026, 11, 16)],
  ])('sets `from` to local midnight 30 calendar days back (%s)', (_label, now, expectedFrom) => {
    const range = defaultDateRange(now.getTime());

    expect(range.from.getTime()).toBe(expectedFrom.getTime());
  });
});
