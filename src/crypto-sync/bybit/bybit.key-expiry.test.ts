import { DAY_MS } from '@kiko/dates';

import { keyExpiryStateOf } from './bybit.key-expiry';

const NOW = 1_700_000_000_000;

describe('reads each expiry state from the stored date', () => {
  it.each([
    ['never read', undefined],
    ['an entry with no field', {}],
    ['a read time alone', { readAtMs: NOW }],
  ])('is unknown for %s', (_title, stored) => {
    expect(keyExpiryStateOf(stored, NOW)).toEqual({ state: 'unknown' });
  });

  it('is far for an end more than 14 days off', () => {
    expect(keyExpiryStateOf({ expiredAtMs: NOW + 60 * DAY_MS }, NOW)).toEqual({
      state: 'far',
      endsAtMs: NOW + 60 * DAY_MS,
    });
  });

  it('is far one millisecond past the 14th day', () => {
    expect(keyExpiryStateOf({ expiredAtMs: NOW + 14 * DAY_MS + 1 }, NOW)).toMatchObject({
      state: 'far',
    });
  });

  it.each([
    [14 * DAY_MS, 14],
    [13 * DAY_MS + 1, 14],
    [2 * DAY_MS, 2],
    [DAY_MS, 1],
    [1, 1],
  ])('is near with %i ms left, counting %i whole days rounded up', (left, daysLeft) => {
    expect(keyExpiryStateOf({ expiredAtMs: NOW + left }, NOW)).toEqual({
      state: 'near',
      endsAtMs: NOW + left,
      daysLeft,
    });
  });

  it.each([[0], [1], [30 * DAY_MS]])('is expired %i ms after the end', (after) => {
    expect(keyExpiryStateOf({ expiredAtMs: NOW - after }, NOW)).toEqual({
      state: 'expired',
      endsAtMs: NOW - after,
    });
  });

  it.each([[0], [-5]])('reads an end of %i as no end', (expiredAtMs) => {
    expect(keyExpiryStateOf({ expiredAtMs }, NOW)).toEqual({ state: 'unknown' });
  });

  describe('with no end, from the days left at the read', () => {
    it('is far for a key with 91 days left two days ago', () => {
      expect(keyExpiryStateOf({ deadlineDay: 91, readAtMs: NOW - 2 * DAY_MS }, NOW)).toEqual({
        state: 'far',
        endsAtMs: NOW + 89 * DAY_MS,
      });
    });

    it('is near for 5 days left at the read', () => {
      expect(keyExpiryStateOf({ deadlineDay: 5, readAtMs: NOW }, NOW)).toEqual({
        state: 'near',
        endsAtMs: NOW + 5 * DAY_MS,
        daysLeft: 5,
      });
    });

    it('is expired once the days have run out since the read', () => {
      expect(keyExpiryStateOf({ deadlineDay: 3, readAtMs: NOW - 4 * DAY_MS }, NOW)).toEqual({
        state: 'expired',
        endsAtMs: NOW - DAY_MS,
      });
    });

    it.each([[-2], [0], [Number.NaN]])('is unknown for %p days', (deadlineDay) => {
      expect(keyExpiryStateOf({ deadlineDay, readAtMs: NOW }, NOW)).toEqual({ state: 'unknown' });
    });

    it('is unknown when the read time is not stored', () => {
      expect(keyExpiryStateOf({ deadlineDay: 50 }, NOW)).toEqual({ state: 'unknown' });
    });

    it('is overruled by an end that is stored', () => {
      expect(
        keyExpiryStateOf({ expiredAtMs: NOW + 60 * DAY_MS, deadlineDay: 2, readAtMs: NOW }, NOW),
      ).toMatchObject({ state: 'far', endsAtMs: NOW + 60 * DAY_MS });
    });
  });
});
