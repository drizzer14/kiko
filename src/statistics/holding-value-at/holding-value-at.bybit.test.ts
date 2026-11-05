import {
  createHoldingValuer,
  type SeriesHolding,
  type SeriesTransaction,
} from './holding-value-at';

const ONE_COIN = 100_000_000;
const FIFTH_OF_A_COIN = 20_000_000;
const HALF_OF_A_COIN = 50_000_000;
const KEY = 'BTC:unified';

// A local calendar day of January 2026 at an hour, built from local fields: the valuer buckets by
// LOCAL day, so no fixed-millisecond offset may stand for a day.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const midnightOf = (day: number): number => at(day, 0);

const row = (
  time: number,
  amountMinorUnits: number,
  source: SeriesTransaction['source'] = 'bybit',
): SeriesTransaction => ({ time, amountMinorUnits, source });

const holdingOf = (
  balanceMinorUnits: number,
  metadata: SeriesHolding['metadata'],
): SeriesHolding => ({
  id: 'coin1',
  currency: 'BTC',
  type: 'crypto_asset',
  balanceMinorUnits,
  metadata,
  closedAt: null,
});

const bybitMetadata = (readAt: number): SeriesHolding['metadata'] => ({
  bybitAsset: KEY,
  syncedAt: readAt,
  balanceReadAt: readAt,
});

// The line at local midnight of each day offset in `days`, as the series samples it.
const lineOf = (holding: SeriesHolding, rows: SeriesTransaction[], days: number[]): number[] => {
  const valueAt = createHoldingValuer(holding, rows);

  return days.map((day) => valueAt(midnightOf(day)));
};

describe('createHoldingValuer against a Bybit holding whose balance was read before its rows', () => {
  it('row 1, a fill after the read with no new read, holds the read balance', () => {
    const holding = holdingOf(ONE_COIN, bybitMetadata(at(0, 10)));
    const rows = [row(at(1, 9), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1, 2])).toEqual([ONE_COIN, ONE_COIN, ONE_COIN, ONE_COIN]);
  });

  it('rows 2 and 3, a fill older than the read counts once the read holds it', () => {
    const holding = holdingOf(ONE_COIN - FIFTH_OF_A_COIN, bybitMetadata(at(2, 10)));
    const rows = [row(at(1, 9), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([
      ONE_COIN,
      ONE_COIN - FIFTH_OF_A_COIN,
      ONE_COIN - FIFTH_OF_A_COIN,
    ]);
  });

  it('row 4, a row from before the read that arrives late counts', () => {
    const holding = holdingOf(ONE_COIN, bybitMetadata(at(0, 10)));
    const rows = [row(at(-2, 12), ONE_COIN)];

    expect(lineOf(holding, rows, [-3, -2, -1, 0])).toEqual([0, ONE_COIN, ONE_COIN, ONE_COIN]);
  });

  it('row 5, a holding made at zero with no read counts no row and never opens below zero', () => {
    const holding = holdingOf(0, { bybitAsset: KEY });
    const rows = [row(at(0, 12), ONE_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1])).toEqual([0, 0, 0]);
  });

  it('row 6, a sale that arrives first counts no row and never opens above zero', () => {
    const holding = holdingOf(0, { bybitAsset: KEY });
    const rows = [row(at(0, 12), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1])).toEqual([0, 0, 0]);
  });

  it('row 7, the first read after both rows brings the past back', () => {
    const holding = holdingOf(ONE_COIN - FIFTH_OF_A_COIN, bybitMetadata(at(2, 10)));
    const rows = [row(at(0, 12), ONE_COIN), row(at(1, 12), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1, 2])).toEqual([
      0,
      ONE_COIN,
      ONE_COIN - FIFTH_OF_A_COIN,
      ONE_COIN - FIFTH_OF_A_COIN,
    ]);
  });

  it('row 8, a disconnected holding keeps its read date and reads as row 1', () => {
    const holding = holdingOf(ONE_COIN, { bybitAsset: KEY, balanceReadAt: at(0, 10) });
    const rows = [row(at(1, 9), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1, 2])).toEqual([ONE_COIN, ONE_COIN, ONE_COIN, ONE_COIN]);
  });

  it('row 9, a manual row after the old read counts in full, on top of the held balance', () => {
    const holding = holdingOf(ONE_COIN + HALF_OF_A_COIN, bybitMetadata(at(0, 10)));
    const rows = [row(at(1, 9), -FIFTH_OF_A_COIN), row(at(2, 9), HALF_OF_A_COIN, 'manual')];

    expect(lineOf(holding, rows, [0, 1, 2, 3])).toEqual([
      ONE_COIN,
      ONE_COIN,
      ONE_COIN + HALF_OF_A_COIN,
      ONE_COIN + HALF_OF_A_COIN,
    ]);
  });

  it('row 12, a deposit after the read leaves the line flat, then a read of the new balance counts it', () => {
    const deposit = row(at(1, 9), 3_000_000);
    const beforeNextRead = holdingOf(5_000_000, bybitMetadata(at(0, 10)));
    const afterNextRead = holdingOf(8_000_000, bybitMetadata(at(2, 10)));

    expect(lineOf(beforeNextRead, [deposit], [0, 1, 2])).toEqual([5_000_000, 5_000_000, 5_000_000]);
    expect(lineOf(afterNextRead, [deposit], [0, 1, 2])).toEqual([5_000_000, 8_000_000, 8_000_000]);
  });

  it('a row exactly at the read counts, and a row one millisecond after it does not', () => {
    const readAt = at(1, 10);
    const holding = holdingOf(10, bybitMetadata(readAt));
    const rows = [row(readAt, 3), row(readAt + 1, -2)];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([7, 10, 10]);
  });

  it("a row dated later on the read's local day does not count", () => {
    const holding = holdingOf(ONE_COIN, bybitMetadata(at(1, 10)));
    const rows = [row(at(1, 15), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([ONE_COIN, ONE_COIN, ONE_COIN]);
  });

  it('a row earlier on the read local day counts from the start of that day', () => {
    const holding = holdingOf(ONE_COIN, bybitMetadata(at(1, 10)));
    const rows = [row(at(1, 8), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([
      ONE_COIN + FIFTH_OF_A_COIN,
      ONE_COIN,
      ONE_COIN,
    ]);
  });

  it('a holding with a stamp and no read date counts no Bybit row and opens at its balance', () => {
    const holding = holdingOf(ONE_COIN, { bybitAsset: KEY, syncedAt: at(0, 10) });
    const rows = [row(at(-1, 12), ONE_COIN), row(at(1, 12), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-2, -1, 0, 1, 2])).toEqual([
      ONE_COIN,
      ONE_COIN,
      ONE_COIN,
      ONE_COIN,
      ONE_COIN,
    ]);
  });

  it('a read date that is not a number counts as no date', () => {
    const holding = holdingOf(ONE_COIN, { bybitAsset: KEY, balanceReadAt: '1700000000000' });
    const rows = [row(at(0, 12), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1])).toEqual([ONE_COIN, ONE_COIN, ONE_COIN]);
  });

  it.each([['manual'], ['import'], ['monobank'], ['binance'], [undefined]] as const)(
    'a row of source %s counts on a Bybit holding, whatever the read date',
    (source) => {
      const holding = holdingOf(ONE_COIN, bybitMetadata(at(0, 10)));
      const rows = [{ time: at(1, 9), amountMinorUnits: -FIFTH_OF_A_COIN, source }];

      expect(lineOf(holding, rows, [0, 1])).toEqual([ONE_COIN + FIFTH_OF_A_COIN, ONE_COIN]);
    },
  );

  it('ends on the stored balance, with rows on both sides of the read and a manual row after it', () => {
    const holding = holdingOf(ONE_COIN + HALF_OF_A_COIN, bybitMetadata(at(2, 10)));
    const rows = [
      row(at(0, 12), ONE_COIN),
      row(at(1, 12), -FIFTH_OF_A_COIN),
      row(at(3, 12), FIFTH_OF_A_COIN),
      row(at(4, 12), HALF_OF_A_COIN, 'manual'),
    ];

    expect(createHoldingValuer(holding, rows)(at(10, 0))).toBe(ONE_COIN + HALF_OF_A_COIN);
  });
});

describe('createHoldingValuer against a holding that is not a Bybit one', () => {
  // A row whose own fields count every read: the filter must add no pass for a holding that is
  // not Bybit's, so each row is read exactly twice (`time`, `amountMinorUnits`) and `source` never.
  const countedRow = (
    time: number,
    amountMinorUnits: number,
    readCounter: { reads: number; sourceReads: number },
  ): SeriesTransaction => ({
    get time() {
      readCounter.reads += 1;

      return time;
    },
    get amountMinorUnits() {
      readCounter.reads += 1;

      return amountMinorUnits;
    },
    get source() {
      readCounter.sourceReads += 1;

      return 'bybit' as const;
    },
  });

  it.each([
    ['a Binance key', { binanceAsset: 'BTC', syncedAt: at(0, 10), balanceReadAt: at(0, 10) }],
    ['a Monobank key', { monobankId: 'card-1', syncedAt: at(0, 10), balanceReadAt: at(0, 10) }],
    ['a wallet address', { walletAddress: 'bc1q', syncedAt: at(0, 10), balanceReadAt: at(0, 10) }],
    ['no source key', { balanceReadAt: at(0, 10) }],
    ['no metadata', null],
  ])('reads each row twice and counts every row, with %s', (_, metadata) => {
    const readCounter = { reads: 0, sourceReads: 0 };
    const rows = [
      countedRow(at(1, 9), -FIFTH_OF_A_COIN, readCounter),
      countedRow(at(-1, 9), ONE_COIN, readCounter),
    ];
    const valueAt = createHoldingValuer(holdingOf(ONE_COIN, metadata), rows);

    expect(valueAt(midnightOf(-2))).toBe(FIFTH_OF_A_COIN);
    expect(valueAt(midnightOf(0))).toBe(ONE_COIN + FIFTH_OF_A_COIN);
    expect(valueAt(midnightOf(1))).toBe(ONE_COIN);
    expect(readCounter).toEqual({ reads: 4, sourceReads: 0 });
  });
});
