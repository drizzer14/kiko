import { defaultDateRange } from './default-range';
import { DAY_MS } from './duration';

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

  it('spans approximately 30 days between `from` and `to`', () => {
    const now = new Date(2026, 8, 6, 15, 30).getTime();

    const range = defaultDateRange(now);
    const spanDays = (range.to.getTime() - range.from.getTime()) / DAY_MS;

    expect(spanDays).toBeGreaterThanOrEqual(29);
    expect(spanDays).toBeLessThanOrEqual(31);
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
