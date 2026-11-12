import {
  createHoldingValuer,
  type SeriesHolding,
  type SeriesTransaction,
} from './holding-value-at';

const ONE_COIN = 100_000_000;
const TWELVE_TENTHS_OF_A_COIN = 120_000_000;
const FIFTH_OF_A_COIN = 20_000_000;
const TENTH_OF_A_COIN = 10_000_000;
const HALF_OF_A_COIN = 50_000_000;
const EIGHT_TENTHS_OF_A_COIN = 80_000_000;

// A local calendar day of January 2026 at an hour, built from local fields: the valuer buckets by
// LOCAL day, so no fixed-millisecond offset may stand for a day.
const at = (day: number, hour = 12): number => new Date(2026, 0, 1 + day, hour).getTime();

const midnightOf = (day: number): number => at(day, 0);

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

// The line at local midnight of each day offset in `days`, as the series samples it.
const lineOf = (holding: SeriesHolding, rows: SeriesTransaction[], days: number[]): number[] => {
  const valueAt = createHoldingValuer(holding, rows);

  return days.map((day) => valueAt(midnightOf(day)));
};

const binanceRow = (time: number, amountMinorUnits: number): SeriesTransaction => ({
  time,
  amountMinorUnits,
  source: 'binance',
});

// A holding that shipped before the read was dated: a key and the time of the last sync, and no
// read time.
const shippedBinance = { binanceAsset: 'BTC', syncedAt: at(0, 10) };

const datedBinance = (readAt: number): Record<string, unknown> => ({
  binanceAsset: 'BTC',
  syncedAt: readAt,
  balanceReadAt: readAt,
});

describe('createHoldingValuer against an undated Binance holding, which counts every row as it did', () => {
  it('R1, a shipped holding that is connected keeps the buy before its last read', () => {
    const holding = holdingOf(ONE_COIN, shippedBinance);
    const rows = [binanceRow(at(0, 9), ONE_COIN)];

    expect(lineOf(holding, rows, [-1, 0])).toEqual([0, ONE_COIN]);
  });

  it('R3, a shipped holding that was disconnected keeps its whole past', () => {
    const holding = holdingOf(ONE_COIN, { binanceAsset: 'BTC' });
    const rows = [
      binanceRow(at(0, 9), TWELVE_TENTHS_OF_A_COIN),
      binanceRow(at(1, 9), -FIFTH_OF_A_COIN),
    ];

    expect(lineOf(holding, rows, [-1, 0, 1])).toEqual([0, TWELVE_TENTHS_OF_A_COIN, ONE_COIN]);
  });

  it('R4, a fill after the last read of a shipped holding keeps its line until the first dated read, then holds', () => {
    const rows = [binanceRow(at(1, 9), -FIFTH_OF_A_COIN)];

    expect(lineOf(holdingOf(ONE_COIN, shippedBinance), rows, [0, 1])).toEqual([
      TWELVE_TENTHS_OF_A_COIN,
      ONE_COIN,
    ]);
    expect(lineOf(holdingOf(ONE_COIN, datedBinance(at(0, 10))), rows, [0, 1])).toEqual([
      ONE_COIN,
      ONE_COIN,
    ]);
    expect(
      lineOf(holdingOf(EIGHT_TENTHS_OF_A_COIN, datedBinance(at(2, 10))), rows, [0, 1]),
    ).toEqual([ONE_COIN, EIGHT_TENTHS_OF_A_COIN]);
  });

  it('R6, a holding made at zero that a buy reaches before any read opens below zero as it did', () => {
    const holding = holdingOf(0, { binanceAsset: 'BTC' });
    const rows = [binanceRow(at(0, 12), ONE_COIN)];

    expect(lineOf(holding, rows, [-1, 0])).toEqual([-ONE_COIN, 0]);
  });
});

describe('createHoldingValuer against a Binance holding whose balance was read before its rows', () => {
  it('W1, a fill that the walk of the read run wrote after it holds the read balance', () => {
    const holding = holdingOf(ONE_COIN, datedBinance(at(0, 10)));
    const rows = [binanceRow(at(1, 9), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1, 2])).toEqual([ONE_COIN, ONE_COIN, ONE_COIN, ONE_COIN]);
  });

  it('W2, a read after the fill counts it from its own day', () => {
    const holding = holdingOf(EIGHT_TENTHS_OF_A_COIN, datedBinance(at(2, 10)));
    const rows = [binanceRow(at(1, 9), -FIFTH_OF_A_COIN)];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([
      ONE_COIN,
      EIGHT_TENTHS_OF_A_COIN,
      EIGHT_TENTHS_OF_A_COIN,
    ]);
  });

  it('W4, a typed row that the read overwrote is left off the line', () => {
    const holding = holdingOf(TENTH_OF_A_COIN, {
      ...datedBinance(at(2, 10)),
      overwrittenRowIds: ['typed'],
    });
    const rows: SeriesTransaction[] = [
      { id: 'typed', time: at(1, 9), amountMinorUnits: HALF_OF_A_COIN, source: 'manual' },
    ];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
    ]);
  });
});

describe('createHoldingValuer against a Monobank card', () => {
  const THOUSAND = 100_000;
  const HUNDRED = 10_000;
  const FIFTY = 5_000;
  const TWENTY = 2_000;
  const THREE_HUNDRED = 30_000;

  const cardOf = (metadata: SeriesHolding['metadata']): SeriesHolding => ({
    id: 'card1',
    currency: 'UAH',
    type: 'card',
    balanceMinorUnits: THOUSAND,
    metadata,
    closedAt: null,
  });

  // The rows of one world: a card payment before the read and one after it, a statement row of a
  // bank account before the read, and a typed row before the read.
  const rows: SeriesTransaction[] = [
    { id: 'payment-before', time: at(-1, 9), amountMinorUnits: THREE_HUNDRED, source: 'monobank' },
    { id: 'payment-after', time: at(1, 9), amountMinorUnits: -HUNDRED, source: 'monobank' },
    { id: 'statement', time: at(-1, 9), amountMinorUnits: FIFTY, source: 'import' },
    { id: 'typed', time: at(-1, 9), amountMinorUnits: TWENTY, source: 'manual' },
  ];

  it('a dated card counts a payment up to its read and a statement row, and leaves out a typed row on its mark and a payment after the read', () => {
    const holding = cardOf({
      monobankId: 'card-1',
      balanceReadAt: at(0, 10),
      overwrittenRowIds: ['typed'],
    });

    expect(lineOf(holding, rows, [-2, -1, 1])).toEqual([
      THOUSAND - THREE_HUNDRED - FIFTY,
      THOUSAND,
      THOUSAND,
    ]);
  });

  it('an undated card counts every row, as it did', () => {
    const holding = cardOf({ monobankId: 'card-1' });
    const opening = THOUSAND - (THREE_HUNDRED - HUNDRED + FIFTY + TWENTY);

    expect(lineOf(holding, rows, [-2, -1, 1])).toEqual([
      opening,
      opening + THREE_HUNDRED + FIFTY + TWENTY,
      THOUSAND,
    ]);
  });
});
