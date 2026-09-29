import { localDaysFrom } from './local-days-from';

const HOUR = 3_600_000;

describe('localDaysFrom', () => {
  it.each([
    ['across the spring DST change', new Date(2026, 2, 28, 12), 1, new Date(2026, 2, 29, 12), 23],
    ['across the autumn DST change', new Date(2026, 9, 24, 12), 1, new Date(2026, 9, 25, 12), 25],
    ['late at night', new Date(2026, 8, 28, 23, 30), 1, new Date(2026, 8, 29, 23, 30), 24],
    ['back across a month end', new Date(2026, 9, 1, 8), -2, new Date(2026, 8, 29, 8), -48],
  ])('steps local calendar days %s', (_case, from, days, expected, elapsedHours) => {
    const stepped = localDaysFrom(from.getTime(), days);

    expect(stepped).toBe(expected.getTime());
    expect(stepped - from.getTime()).toBe(elapsedHours * HOUR);
  });
});
