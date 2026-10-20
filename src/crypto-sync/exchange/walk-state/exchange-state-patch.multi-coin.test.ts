import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';

const FLOOR_MS = 1_000;

const storedOf = (text: string | undefined): unknown => JSON.parse(text ?? 'null');

const resetOf = (walks: Record<string, unknown>): unknown =>
  storedOf(exchangeStateReset(JSON.stringify({ version: 1, walks }), FLOOR_MS));

describe('a disconnect and the multi-coin marks', () => {
  it('removes the marker range and keeps the walk seen', () => {
    expect(
      resetOf({
        capital: { cursor: 5_000, multiCoinSince: 3_000, multiCoinSeen: true },
        pay: { cursor: 5_000, rescan: 4_000, multiCoinSince: 3_000, multiCoinSeen: true },
      }),
    ).toEqual({
      version: 1,
      walks: {
        capital: { cursor: FLOOR_MS, multiCoinSeen: true },
        pay: { cursor: FLOOR_MS, rescan: FLOOR_MS, multiCoinSeen: true },
      },
    });
  });

  it('drops a range that has no seen mark beside it', () => {
    expect(resetOf({ transfer: { cursor: 5_000, multiCoinSince: 3_000 } })).toEqual({
      version: 1,
      walks: { transfer: { cursor: FLOOR_MS } },
    });
  });

  it.each([
    ['false', false],
    ['the text yes', 'yes'],
    ['a number', 1],
  ])('drops a seen mark stored as %s, which no walk reads as seen', (_label, stored) => {
    expect(resetOf({ earn: { cursor: 5_000, multiCoinSeen: stored } })).toEqual({
      version: 1,
      walks: { earn: { cursor: FLOOR_MS } },
    });
  });
});

describe('a walk patch of the multi-coin marks', () => {
  const patchOf = (field: 'multiCoinSince' | 'multiCoinSeen', value: number | true) =>
    ({ kind: 'walk', walkId: 'pay', field, value }) as ExchangeStatePatch;

  it('writes both marks beside the cursor and keeps every other field as stored', () => {
    const text = JSON.stringify({ version: 1, walks: { pay: { cursor: 5, pointCursor: 'junk' } } });

    expect(
      storedOf(
        exchangeStatePatched(text, [
          patchOf('multiCoinSeen', true),
          patchOf('multiCoinSince', 3),
          { kind: 'walk', walkId: 'pay', field: 'cursor', value: 9 },
        ]),
      ),
    ).toEqual({
      version: 1,
      walks: { pay: { cursor: 9, pointCursor: 'junk', multiCoinSeen: true, multiCoinSince: 3 } },
    });
  });
});
