import { minuteOfDayOf, subjectOfDraft, subjectOfStoredRow } from './rule-subject';

const at = (year: number, month: number, day: number, hour: number, minute: number): number =>
  new Date(year, month, day, hour, minute).getTime();

const storedRow = (
  overrides: Partial<Parameters<typeof subjectOfStoredRow>[0]> = {},
): Parameters<typeof subjectOfStoredRow>[0] => ({
  description: 'Silpo',
  amountMinorUnits: -50000,
  time: at(2026, 5, 1, 12, 0),
  currency: 'UAH',
  ...overrides,
});

describe('minuteOfDayOf', () => {
  it.each([
    ['midnight', at(2026, 0, 1, 0, 0), 0],
    ['the last minute of the day', at(2026, 0, 1, 23, 59), 1439],
    ['18:30 on the fall-back day', at(2026, 9, 25, 18, 30), 1110],
    ['18:30 on the spring-forward day', at(2027, 2, 28, 18, 30), 1110],
    ['01:00 after the spring-forward gap', at(2027, 2, 28, 5, 0), 300],
  ])('reads %s as the wall clock minute', (_label, time, expected) => {
    expect(minuteOfDayOf(time)).toBe(expected);
  });
});

describe('subjectOfStoredRow', () => {
  it.each([
    ['an expense', -1, 'expense'],
    ['an income', 1, 'income'],
    ['a zero amount', 0, null],
  ])('maps %s to its direction', (_label, amountMinorUnits, direction) => {
    expect(subjectOfStoredRow(storedRow({ amountMinorUnits })).direction).toBe(direction);
  });

  it.each([
    [-50000, 50000],
    [50000, 50000],
    [0, 0],
  ])('takes the absolute amount of %i', (amountMinorUnits, absoluteMinorUnits) => {
    expect(subjectOfStoredRow(storedRow({ amountMinorUnits })).absoluteMinorUnits).toBe(
      absoluteMinorUnits,
    );
  });

  it('normalizes the description', () => {
    expect(subjectOfStoredRow(storedRow({ description: '  SILPO   Market ' })).normalizedName).toBe(
      'silpo market',
    );
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
  ])('gives a %s description a blank name', (_label, description) => {
    expect(subjectOfStoredRow(storedRow({ description })).normalizedName).toBe('');
  });

  it('carries the currency and the wall clock minute', () => {
    const subject = subjectOfStoredRow(
      storedRow({ currency: 'BTC', time: at(2026, 9, 25, 18, 30) }),
    );

    expect(subject.currency).toBe('BTC');
    expect(subject.minuteOfDay).toBe(1110);
  });
});

describe('subjectOfDraft', () => {
  const draft = {
    description: ' Silpo ',
    absoluteMinorUnits: 12500,
    currency: 'USD' as const,
    direction: 'income' as const,
    time: at(2027, 2, 28, 18, 30),
  };

  it('carries every draft field, normalizing the name', () => {
    expect(subjectOfDraft(draft)).toEqual({
      normalizedName: 'silpo',
      absoluteMinorUnits: 12500,
      currency: 'USD',
      direction: 'income',
      minuteOfDay: 1110,
    });
  });

  it('keeps a blank amount and a missing currency null', () => {
    const subject = subjectOfDraft({ ...draft, absoluteMinorUnits: null, currency: null });

    expect(subject.absoluteMinorUnits).toBeNull();
    expect(subject.currency).toBeNull();
  });
});
