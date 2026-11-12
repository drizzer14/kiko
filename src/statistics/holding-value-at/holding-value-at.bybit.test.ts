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

describe('createHoldingValuer against a Bybit holding whose read overwrote typed rows', () => {
  const TENTH_OF_A_COIN = 10_000_000;
  const THREE_TENTHS_OF_A_COIN = 30_000_000;

  const typedRow = (
    id: string,
    time: number,
    amountMinorUnits: number,
    source: SeriesTransaction['source'] = 'manual',
  ): SeriesTransaction => ({ id, time, amountMinorUnits, source });

  const markedMetadata = (readAt: number, mark: unknown): SeriesHolding['metadata'] => ({
    bybitAsset: KEY,
    syncedAt: readAt,
    balanceReadAt: readAt,
    overwrittenRowIds: mark,
  });

  it('row 15, a row on the mark does not count', () => {
    const holding = holdingOf(TENTH_OF_A_COIN, markedMetadata(at(2, 10), ['typed']));
    const rows = [typedRow('typed', at(1, 9), HALF_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1, 2, 3])).toEqual(Array(5).fill(TENTH_OF_A_COIN));
  });

  it('row 15, the other sign: a row of -0.5 on the mark does not count', () => {
    const holding = holdingOf(ONE_COIN, markedMetadata(at(2, 10), ['typed']));
    const rows = [typedRow('typed', at(1, 9), -HALF_OF_A_COIN)];

    expect(lineOf(holding, rows, [-1, 0, 1, 2, 3])).toEqual(Array(5).fill(ONE_COIN));
  });

  it('a row typed after the read counts, beside a row on the mark', () => {
    const holding = holdingOf(
      TENTH_OF_A_COIN + THREE_TENTHS_OF_A_COIN,
      markedMetadata(at(2, 10), ['typed']),
    );
    const rows = [
      typedRow('typed', at(1, 9), HALF_OF_A_COIN),
      typedRow('later', at(3, 9), THREE_TENTHS_OF_A_COIN),
    ];

    expect(lineOf(holding, rows, [0, 1, 2, 3, 4])).toEqual([
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN + THREE_TENTHS_OF_A_COIN,
      TENTH_OF_A_COIN + THREE_TENTHS_OF_A_COIN,
    ]);
  });

  it('a row typed after the read counts even when it is dated before the read', () => {
    const holding = holdingOf(TENTH_OF_A_COIN, markedMetadata(at(2, 10), ['typed']));
    const rows = [
      typedRow('typed', at(1, 9), HALF_OF_A_COIN),
      typedRow('older', at(-1, 9), -FIFTH_OF_A_COIN),
    ];

    expect(lineOf(holding, rows, [-2, -1, 0, 1])).toEqual([
      TENTH_OF_A_COIN + FIFTH_OF_A_COIN,
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
    ]);
  });

  describe('row 24, a mark that names no row of the line changes nothing', () => {
    // A Bybit row before the read, a typed row on day 1 and a Bybit row after the read: with no
    // usable mark the first two count, the third does not, and the opening is 0.
    const rows = [
      typedRow('before', at(-1, 12), ONE_COIN, 'bybit'),
      typedRow('typed', at(1, 12), HALF_OF_A_COIN),
      typedRow('after', at(2, 12), -FIFTH_OF_A_COIN, 'bybit'),
    ];
    const lineWithNoUsableMark = [
      0,
      ONE_COIN,
      ONE_COIN,
      ONE_COIN + HALF_OF_A_COIN,
      ONE_COIN + HALF_OF_A_COIN,
      ONE_COIN + HALF_OF_A_COIN,
    ];

    it.each([
      ['an id with no row', ['ghost']],
      ['a Bybit row before the read', ['before']],
      ['a Bybit row after the read', ['after']],
      ['a list of what is not text', [5, null, { id: 'typed' }]],
      ['text in place of a list', 'typed'],
      ['an object in place of a list', { typed: true }],
      ['an empty list', []],
      ['null', null],
    ])('with a mark that names %s', (_, mark) => {
      const holding = holdingOf(ONE_COIN + HALF_OF_A_COIN, markedMetadata(at(0, 10), mark));

      expect(lineOf(holding, rows, [-2, -1, 0, 1, 2, 3])).toEqual(lineWithNoUsableMark);
    });

    it('with a mark that names the typed row beside it, only that row goes', () => {
      const holding = holdingOf(ONE_COIN + HALF_OF_A_COIN, markedMetadata(at(0, 10), ['typed']));

      expect(lineOf(holding, rows, [-2, -1, 0, 1, 2, 3])).toEqual([
        HALF_OF_A_COIN,
        ONE_COIN + HALF_OF_A_COIN,
        ONE_COIN + HALF_OF_A_COIN,
        ONE_COIN + HALF_OF_A_COIN,
        ONE_COIN + HALF_OF_A_COIN,
        ONE_COIN + HALF_OF_A_COIN,
      ]);
    });
  });

  it('a row with no id counts, whatever the mark holds', () => {
    const holding = holdingOf(TENTH_OF_A_COIN, markedMetadata(at(2, 10), ['', 'typed']));
    const rows = [{ time: at(1, 9), amountMinorUnits: HALF_OF_A_COIN, source: 'manual' as const }];

    expect(lineOf(holding, rows, [0, 1, 2])).toEqual([
      TENTH_OF_A_COIN - HALF_OF_A_COIN,
      TENTH_OF_A_COIN,
      TENTH_OF_A_COIN,
    ]);
  });
});

// A row whose own fields count every read, so a test can pin how many times the filter touches a
// row: `time` and `amountMinorUnits` are what the sum itself reads, `source` and `id` are what the
// filter reads for a holding whose balance is dated.
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
  get id() {
    readCounter.sourceReads += 1;

    return 'row-1';
  },
});

// The reads of two rows over three buckets of a holding of one coin, and the line they gave.
const valuedWithCountedRows = (
  metadata: SeriesHolding['metadata'],
): { readCounter: { reads: number; sourceReads: number }; line: number[] } => {
  const readCounter = { reads: 0, sourceReads: 0 };
  const rows = [
    countedRow(at(1, 9), -FIFTH_OF_A_COIN, readCounter),
    countedRow(at(-1, 9), ONE_COIN, readCounter),
  ];
  const valueAt = createHoldingValuer(holdingOf(ONE_COIN, metadata), rows);

  return {
    readCounter,
    line: [valueAt(midnightOf(-2)), valueAt(midnightOf(0)), valueAt(midnightOf(1))],
  };
};

describe('createHoldingValuer against a holding that is not on the dated list', () => {
  // The filter must add no pass for a holding off the list, so each row is read exactly twice
  // (`time`, `amountMinorUnits`) and neither `source` nor `id` is ever read.
  it.each([
    ['no source key', { balanceReadAt: at(0, 10) }],
    ['no metadata', null],
  ])('reads each row twice and counts every row, with %s', (_, metadata) => {
    const { readCounter, line } = valuedWithCountedRows(metadata);

    expect(line).toEqual([FIFTH_OF_A_COIN, ONE_COIN + FIFTH_OF_A_COIN, ONE_COIN]);
    expect(readCounter).toEqual({ reads: 4, sourceReads: 0 });
  });
});

describe('createHoldingValuer against a Binance, a wallet or a Monobank holding, whose balance is dated', () => {
  // A holding on the list pays the filter's pass: each row is read twice for the sum, and its
  // `source` and its `id` once each, so two rows read four times for the filter. Measured on the
  // tip; a row read more often than that is a second pass over the ledger.
  it.each([
    ['a Binance key', { binanceAsset: 'BTC', syncedAt: at(0, 10), balanceReadAt: at(0, 10) }],
    ['a wallet address', { walletAddress: 'bc1q', syncedAt: at(0, 10), balanceReadAt: at(0, 10) }],
    ['a Monobank key', { monobankId: 'card-1', syncedAt: at(0, 10), balanceReadAt: at(0, 10) }],
  ])('reads each row four times in all and counts every row, with %s', (_, metadata) => {
    const { readCounter, line } = valuedWithCountedRows(metadata);

    expect(line).toEqual([FIFTH_OF_A_COIN, ONE_COIN + FIFTH_OF_A_COIN, ONE_COIN]);
    expect(readCounter).toEqual({ reads: 4, sourceReads: 4 });
  });
});
