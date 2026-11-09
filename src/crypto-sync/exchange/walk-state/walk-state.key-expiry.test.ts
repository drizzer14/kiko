import { parseExchangeState } from './walk-state';

const stateWith = (keyExpiry?: unknown, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest, keyExpiry });

const parsedKeyExpiry = (keyExpiry?: unknown) => {
  const parsed = parseExchangeState(stateWith(keyExpiry));

  return parsed.kind === 'parsed' ? parsed : undefined;
};

describe('the stored key expiry', () => {
  it('reads the end, the days left at the read and the read time', () => {
    const stored = { expiredAtMs: 1_800_000_000_000, deadlineDay: 91, readAtMs: 1_700_000_000_000 };

    expect(parsedKeyExpiry(stored)?.keyExpiry).toEqual(stored);
  });

  it('reads none for a state that never stored one, with nothing unreadable', () => {
    expect(parsedKeyExpiry()).toMatchObject({ keyExpiry: undefined, unreadable: [] });
  });

  it('reads an entry with no field as an entry with no field', () => {
    expect(parsedKeyExpiry({})).toMatchObject({ keyExpiry: {}, unreadable: [] });
  });

  it.each([
    ['text', { expiredAtMs: '1800000000000' }],
    ['the epoch', { expiredAtMs: 0 }],
    ['before the epoch', { expiredAtMs: -5 }],
    ['not finite', { expiredAtMs: null }],
  ])('reads an end that is %s as absent', (_title, entry) => {
    expect(parsedKeyExpiry({ ...entry, readAtMs: 5 })?.keyExpiry).toEqual({ readAtMs: 5 });
  });

  it.each([
    ['text', { deadlineDay: '91' }],
    ['null', { deadlineDay: null }],
  ])('reads days left that are %s as absent', (_title, entry) => {
    expect(parsedKeyExpiry({ ...entry, readAtMs: 5 })?.keyExpiry).toEqual({ readAtMs: 5 });
  });

  it('keeps a negative count of days, which the state rule reads as unknown', () => {
    expect(parsedKeyExpiry({ deadlineDay: -2, readAtMs: 5 })?.keyExpiry).toEqual({
      deadlineDay: -2,
      readAtMs: 5,
    });
  });

  it.each([
    ['text', { readAtMs: '5' }],
    ['negative', { readAtMs: -1 }],
    ['a fraction', { readAtMs: 1.5 }],
  ])('reads a read time that is %s as absent', (_title, entry) => {
    expect(parsedKeyExpiry({ expiredAtMs: 7, ...entry })?.keyExpiry).toEqual({ expiredAtMs: 7 });
  });

  it.each([
    ['a list', ['x']],
    ['a number', 7],
    ['text', 'x'],
    ['null', null],
  ])('names the entry unreadable and reads none when it is %s', (_title, entry) => {
    expect(parsedKeyExpiry(entry)).toMatchObject({
      keyExpiry: undefined,
      unreadable: ['keyExpiry'],
    });
  });

  it('is the only part of the state it changes', () => {
    const rest = { balanceSyncedAt: 9, notImported: ['p2p-sale:1:2'], laterBuildKey: { kept: 1 } };
    const without = parseExchangeState(stateWith(undefined, rest));
    const withEntry = parseExchangeState(stateWith({ expiredAtMs: 7, readAtMs: 5 }, rest));

    expect(withEntry).toEqual({
      ...without,
      keyExpiry: { expiredAtMs: 7, readAtMs: 5 },
    });
  });
});
