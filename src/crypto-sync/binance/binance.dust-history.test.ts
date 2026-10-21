import { type DustEntryOutcome, dustRowsOf } from './binance.dust-history';
import type { BinanceDustEntry, BinanceDustRecord } from './binance.history-client';
import { DUST_OPERATED_AT, dustEntryOf, dustRecordOf } from './binance.dust-test-fixtures';

const ACCOUNT = 'acc-1';
const PAIR_PREFIX = `${ACCOUNT}:dust:record-1`;
const TRX_OUT = -9;
const BNB_IN = 4410;
const UNREADABLE = { kind: 'stopped', code: 'dust-row-unreadable' };

const outcomesOf = (
  entries: Partial<BinanceDustEntry>[],
  record: Partial<BinanceDustRecord> = {},
): DustEntryOutcome[] =>
  dustRowsOf({
    accountId: ACCOUNT,
    record: dustRecordOf({ ...record, entries: entries.map((entry) => dustEntryOf(entry)) }),
  });

const rowsOf = (entry: Partial<BinanceDustEntry> = {}) => {
  const [outcome] = outcomesOf([entry]);

  if (outcome?.kind !== 'rows') {
    throw new Error(`expected rows, got ${outcome?.kind}`);
  }

  return outcome;
};

const stopOf = (entry: Partial<BinanceDustEntry> = {}) => {
  const [outcome] = outcomesOf([entry]);

  return outcome?.kind === 'stopped' ? outcome : undefined;
};

describe('dustRowsOf', () => {
  it('maps a tracked coin into a pair on Spot: the coin out, BNB in, each naming the other holding', () => {
    expect(rowsOf()).toEqual({
      kind: 'rows',
      untracked: [],
      rows: [
        {
          wallet: 'TRX',
          counterpartWallet: 'BNB',
          amountMinorUnits: TRX_OUT,
          time: DUST_OPERATED_AT,
          externalId: `${PAIR_PREFIX}:TRX:TRX`,
          exchangePairId: `${PAIR_PREFIX}:TRX`,
          description: '',
          operation: 'dust',
        },
        {
          wallet: 'BNB',
          counterpartWallet: 'TRX',
          amountMinorUnits: BNB_IN,
          time: DUST_OPERATED_AT,
          externalId: `${PAIR_PREFIX}:TRX:BNB`,
          exchangePairId: `${PAIR_PREFIX}:TRX`,
          description: '',
          operation: 'dust',
        },
      ],
    });
  });

  it('gives each entry of a record its own pair, keyed by the record id and the coin', () => {
    const outcomes = outcomesOf([{ fromAsset: 'TRX' }, { fromAsset: 'DOGE', amount: '0.0002' }]);

    expect(
      outcomes.map((outcome) =>
        outcome.kind === 'rows'
          ? outcome.rows.map(({ externalId, exchangePairId }) => [externalId, exchangePairId])
          : outcome.kind,
      ),
    ).toEqual([
      [
        [`${PAIR_PREFIX}:TRX:TRX`, `${PAIR_PREFIX}:TRX`],
        [`${PAIR_PREFIX}:TRX:BNB`, `${PAIR_PREFIX}:TRX`],
      ],
      [
        [`${PAIR_PREFIX}:DOGE:DOGE`, `${PAIR_PREFIX}:DOGE`],
        [`${PAIR_PREFIX}:DOGE:BNB`, `${PAIR_PREFIX}:DOGE`],
      ],
    ]);
  });

  it('keys the pairs of two accounts apart for one record', () => {
    const [other] = dustRowsOf({ accountId: 'acc-2', record: dustRecordOf() });

    expect(other).toMatchObject({
      rows: [
        { exchangePairId: 'acc-2:dust:record-1:TRX' },
        { exchangePairId: 'acc-2:dust:record-1:TRX' },
      ],
    });
  });

  it('carries operation dust and an empty description on each leg', () => {
    const { rows } = rowsOf();

    expect(rows.map(({ operation }) => operation)).toEqual(['dust', 'dust']);
    expect(rows.map(({ description }) => description)).toEqual(['', '']);
  });

  it('dates both legs by the record', () => {
    const [outcome] = dustRowsOf({
      accountId: ACCOUNT,
      record: dustRecordOf({ operateTime: 1_700_000_000_000 }),
    });

    expect(outcome).toMatchObject({
      rows: [{ time: 1_700_000_000_000 }, { time: 1_700_000_000_000 }],
    });
  });

  it('keeps the BNB leg alone when the coin is not tracked, marking it with that coin', () => {
    expect(rowsOf({ fromAsset: 'PEPE', amount: 'oops' })).toEqual({
      kind: 'rows',
      untracked: ['PEPE'],
      rows: [
        {
          wallet: 'BNB',
          amountMinorUnits: BNB_IN,
          time: DUST_OPERATED_AT,
          externalId: `${PAIR_PREFIX}:PEPE:BNB`,
          untrackedCounterpart: 'asset:PEPE',
          description: '',
          operation: 'dust',
        },
      ],
    });
  });

  it('gives a lone BNB leg no pair id and no counterpart', () => {
    const [leg] = rowsOf({ fromAsset: 'PEPE' }).rows;

    expect(leg).not.toHaveProperty('exchangePairId');
    expect(leg).not.toHaveProperty('counterpartWallet');
  });

  it('refuses an entry of a coin with no usable code', () => {
    expect(stopOf({ fromAsset: 'A:B' })).toEqual(UNREADABLE);
  });

  it('reads the net amount received as it is', () => {
    expect(rowsOf({ transferedAmount: '0.000441' }).rows[1]?.amountMinorUnits).toBe(BNB_IN);
  });

  it.each([
    ['absent', undefined],
    ['blank', ''],
    ['another coin', 'USDT'],
  ])('refuses an entry whose target is %s, before it reads an amount', (_name, targetAsset) => {
    expect(stopOf({ targetAsset, amount: 'oops' })).toEqual(UNREADABLE);
  });

  it('accepts an entry whose target is BNB', () => {
    expect(rowsOf({ targetAsset: 'BNB' }).rows).toHaveLength(2);
  });

  it.each([
    ['absent', undefined],
    ['blank', ''],
    ['BNB', 'BNB'],
  ])('refuses an entry whose source coin is %s', (_name, fromAsset) => {
    expect(stopOf({ fromAsset })).toEqual(UNREADABLE);
  });

  it('refuses every entry of a coin that appears twice in one record, and keeps the others', () => {
    const outcomes = outcomesOf([
      { fromAsset: 'TRX' },
      { fromAsset: 'DOGE', amount: '0.0002' },
      { fromAsset: 'TRX', amount: '0.0003' },
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['stopped', 'rows', 'stopped']);
    expect(outcomes[0]).toEqual(UNREADABLE);
    expect(outcomes[2]).toEqual(UNREADABLE);
  });

  it('refuses a coin that appears twice even when it is not tracked', () => {
    expect(outcomesOf([{ fromAsset: 'PEPE' }, { fromAsset: 'PEPE' }])).toEqual([
      UNREADABLE,
      UNREADABLE,
    ]);
  });

  it.each([
    ['source amount is absent', { amount: undefined }],
    ['received amount is absent', { transferedAmount: undefined }],
    [
      'received amount is absent and whose coin is not tracked',
      {
        fromAsset: 'PEPE',
        transferedAmount: undefined,
      },
    ],
  ])('refuses an entry whose %s', (_name, over) => {
    expect(stopOf(over)).toEqual(UNREADABLE);
  });

  it.each([
    ['source', { amount: 'abc' }],
    ['received', { transferedAmount: '1e-3' }],
  ])('stops an entry whose %s amount is malformed with the parser code', (_name, over) => {
    expect(stopOf(over)).toEqual({ kind: 'stopped', code: 'amount-malformed' });
  });

  it.each([
    ['source', { amount: '-0.0009' }],
    ['received', { transferedAmount: '-0.000441' }],
  ])('stops an entry whose %s amount is negative', (_name, over) => {
    expect(stopOf(over)).toEqual({ kind: 'stopped', code: 'dust-amount-invalid' });
  });

  it('stops an over-precise amount of a coin stored at full scale', () => {
    expect(stopOf({ fromAsset: 'BTC', amount: '0.000000001' })).toEqual({
      kind: 'stopped',
      code: 'amount-precision',
    });
  });

  it('rounds an over-precise amount of a coin stored at a reduced scale', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(rowsOf({ amount: '0.00094' }).rows[0]?.amountMinorUnits).toBe(TRX_OUT);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it.each([
    ['source', { amount: '0' }],
    ['received', { transferedAmount: '0' }],
    ['received of an untracked coin', { fromAsset: 'PEPE', transferedAmount: '0' }],
  ])('gives no row and no stop for an entry whose %s amount is 0 units', (_name, over) => {
    expect(outcomesOf([over])).toEqual([{ kind: 'none' }]);
  });

  it('gives no row and no stop for a received amount that rounds to 0 units', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(outcomesOf([{ transferedAmount: '0.00000004' }])).toEqual([{ kind: 'none' }]);

    warn.mockRestore();
  });

  it('stops on a malformed amount even when the other amount is 0 units', () => {
    expect(stopOf({ amount: '0', transferedAmount: 'abc' })?.code).toBe('amount-malformed');
  });

  it.each([
    ['source', { fromAsset: 'TRX', amount: '9007199254741' }, 'TRX'],
    ['received', { transferedAmount: '900719925475' }, 'BNB'],
  ])('names the coin of a %s amount past the safe integer', (_name, over, coin) => {
    expect(stopOf(over)).toEqual({
      kind: 'stopped',
      code: 'amount-too-large',
      oversizedTicker: coin,
    });
  });

  it('leaves the other entries mapped when one entry stops', () => {
    const outcomes = outcomesOf([
      { fromAsset: 'TRX', amount: 'abc' },
      { fromAsset: 'DOGE', amount: '0.0002' },
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['stopped', 'rows']);
  });
});
