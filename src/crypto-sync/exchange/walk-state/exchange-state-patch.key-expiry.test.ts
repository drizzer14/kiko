import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';

const keyExpiryPatch = (
  fields: { expiredAtMs?: number; deadlineDay?: number },
  readAtMs = 1_700_000_000_000,
): ExchangeStatePatch => ({ kind: 'keyExpiry', ...fields, readAtMs });

const stateWith = (keyExpiry?: unknown, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest, keyExpiry });

const storedOf = (text: string | undefined): Record<string, unknown> => JSON.parse(text ?? 'null');

const expiryOf = (text: string | undefined): unknown => storedOf(text).keyExpiry;

const patched = (seed: unknown, ...patches: ExchangeStatePatch[]): unknown =>
  expiryOf(exchangeStatePatched(stateWith(seed), patches));

describe('the key expiry patch', () => {
  it('writes the end, the days left and the read time into a state that has none', () => {
    expect(
      expiryOf(
        exchangeStatePatched(JSON.stringify({ version: 1, walks: {} }), [
          keyExpiryPatch({ expiredAtMs: 1_800_000_000_000, deadlineDay: 91 }),
        ]),
      ),
    ).toEqual({ expiredAtMs: 1_800_000_000_000, deadlineDay: 91, readAtMs: 1_700_000_000_000 });
  });

  it('writes into a column nothing wrote yet', () => {
    expect(
      expiryOf(exchangeStatePatched(null, [keyExpiryPatch({ expiredAtMs: 1_800_000_000_000 })])),
    ).toEqual({ expiredAtMs: 1_800_000_000_000, readAtMs: 1_700_000_000_000 });
  });

  it('replaces the stored entry whole, so a renewed key moves the date and keeps nothing old', () => {
    const seed = { expiredAtMs: 1_800_000_000_000, deadlineDay: 3, readAtMs: 1_000 };

    expect(patched(seed, keyExpiryPatch({ expiredAtMs: 1_900_000_000_000 }))).toEqual({
      expiredAtMs: 1_900_000_000_000,
      readAtMs: 1_700_000_000_000,
    });
  });

  it('writes a read with no date as the read time alone, so a stale date cannot stand', () => {
    const seed = { expiredAtMs: 1_800_000_000_000, deadlineDay: 3, readAtMs: 1_000 };

    expect(patched(seed, keyExpiryPatch({}))).toEqual({ readAtMs: 1_700_000_000_000 });
  });

  it.each([
    ['a list', ['x']],
    ['a number', 7],
    ['text', 'x'],
    ['null', null],
  ])('replaces a stored entry that is %s', (_title, seed) => {
    expect(patched(seed, keyExpiryPatch({ expiredAtMs: 5 }))).toEqual({
      expiredAtMs: 5,
      readAtMs: 1_700_000_000_000,
    });
  });

  it('leaves every other part of the state as stored', () => {
    const rest = {
      walks: { pay: { cursor: 7 } },
      untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
      balanceNotes: { fund: { refused: true } },
      balanceSyncedAt: 1_000,
      notImported: ['p2p-sale:1:2'],
      laterBuildKey: { kept: true },
    };
    const before = JSON.parse(stateWith(undefined, rest));
    const after = storedOf(
      exchangeStatePatched(stateWith(undefined, rest), [keyExpiryPatch({ expiredAtMs: 5 })]),
    );

    expect(after).toEqual({
      ...before,
      keyExpiry: { expiredAtMs: 5, readAtMs: 1_700_000_000_000 },
    });
  });

  it('writes nothing into a state whose top level is malformed', () => {
    expect(
      exchangeStatePatched('{"version":2,"walks":{}}', [keyExpiryPatch({ expiredAtMs: 5 })]),
    ).toBeUndefined();
  });

  it('is dropped by a disconnect, which keeps the walks and the owner value only, O93', () => {
    const text = stateWith(
      { expiredAtMs: 5, readAtMs: 1 },
      {
        walks: { capital: { cursor: 9 } },
        balanceNotes: { fund: { refused: true } },
        keyOwner: '9f2c',
      },
    );

    expect(storedOf(exchangeStateReset(text, 1_000))).toEqual({
      version: 1,
      walks: { capital: { cursor: 1_000 } },
      keyOwner: '9f2c',
    });
  });
});
