import type { HoldingRow } from '@kiko/db';
import { coinListPatchesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import {
  type BinanceDustHistoryDeps,
  type DustEntryOutcome,
  dustRowsOf,
  syncBinanceDustHistory,
} from './binance.dust-history';
import {
  type BinanceDustEntry,
  type BinanceDustRecord,
  BinanceHistoryParseError,
} from './binance.history-client';
import {
  DUST_OPERATED_AT,
  dustEntryOf,
  dustPageOf,
  dustRecordOf,
} from './binance.dust-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceRateLimitError } from './binance.client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

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

  it.each([
    ['source', 'amount'],
    ['received', 'transferedAmount'],
  ])('lets a failure that is not a stop propagate when reading the %s amount', (_name, field) => {
    const failing = dustEntryOf();
    Object.defineProperty(failing, field, {
      get: () => {
        throw new TypeError('unreadable getter');
      },
    });

    expect(() =>
      dustRowsOf({ accountId: ACCOUNT, record: dustRecordOf({ entries: [failing] }) }),
    ).toThrow(new TypeError('unreadable getter'));
  });
});

const holdingWith = (id: string, key: string): HoldingRow =>
  ({ id, metadata: { binanceAsset: key } }) as unknown as HoldingRow;

const SPOT_HOLDINGS = ['TRX', 'DOGE', 'BNB'].map((coin) =>
  holdingWith(`h-${coin.toLowerCase()}`, coin),
);

type AddedRow = {
  holdingId: string;
  exchangeCounterpartHoldingId?: string;
  amountMinorUnits: number;
  time: number;
  source: string;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
  operation: string;
};

let accountSequence = 0;

/** A connected account with its walk state, and the dust read's deps over that one state. */
const worldOf = (alongside: HoldingRow[] = SPOT_HOLDINGS) => {
  accountSequence += 1;
  const accountId = `acc-dust-${accountSequence}`;
  const fake = walkStateFake({ accountId, alongside });
  const depsOf = (over: Partial<BinanceDustHistoryDeps> = {}): BinanceDustHistoryDeps => ({
    now: () => NOW,
    fetchImpl: (async () => ({})) as unknown as typeof fetch,
    readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
    ensureHoldings: jest.fn(async () => undefined),
    addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
    fetchDustHistory: jest.fn(async () => dustPageOf()),
    ...fake.freshDeps(),
    listHoldings: fake.listHoldings,
    ...over,
  });
  const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });
  const sync = (deps: BinanceDustHistoryDeps, run = freshRun()) =>
    syncBinanceDustHistory({ targetAccountId: accountId, run }, deps);

  return { accountId, fake, depsOf, freshRun, sync };
};

const serverOf = (...records: BinanceDustRecord[]) => jest.fn(async () => dustPageOf(records));

const addedRows = (deps: BinanceDustHistoryDeps): AddedRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap((call) => call[0] as AddedRow[]);

const patchKinds = (deps: BinanceDustHistoryDeps): string[] =>
  (deps.patchExchangeState as jest.Mock).mock.calls.flatMap(([, patches]) =>
    (patches as { kind: string }[]).map(({ kind }) => kind),
  );

describe('syncBinanceDustHistory', () => {
  let warn: jest.SpyInstance;

  const stopCodes = (): string[] => warn.mock.calls.map(([, detail]) => detail.code);

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('imports each tracked entry as a pair on the Spot holdings, each leg naming the other', async () => {
    const { accountId, depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: serverOf(
        dustRecordOf({
          entries: [dustEntryOf(), dustEntryOf({ fromAsset: 'DOGE', amount: '0.0002' })],
        }),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 4 });
    expect(
      addedRows(deps).map(
        ({ holdingId, exchangeCounterpartHoldingId, externalId, exchangePairId }) => [
          holdingId,
          exchangeCounterpartHoldingId,
          externalId,
          exchangePairId,
        ],
      ),
    ).toEqual([
      ['h-trx', 'h-bnb', `${accountId}:dust:record-1:TRX:TRX`, `${accountId}:dust:record-1:TRX`],
      ['h-bnb', 'h-trx', `${accountId}:dust:record-1:TRX:BNB`, `${accountId}:dust:record-1:TRX`],
      [
        'h-doge',
        'h-bnb',
        `${accountId}:dust:record-1:DOGE:DOGE`,
        `${accountId}:dust:record-1:DOGE`,
      ],
      ['h-bnb', 'h-doge', `${accountId}:dust:record-1:DOGE:BNB`, `${accountId}:dust:record-1:DOGE`],
    ]);
    expect(addedRows(deps).every(({ operation }) => operation === 'dust')).toBe(true);
    expect(addedRows(deps).every(({ source }) => source === 'binance')).toBe(true);
  });

  it('imports the BNB leg alone for a coin it does not track, and lists that coin', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: serverOf(
        dustRecordOf({ entries: [dustEntryOf({ fromAsset: 'PEPE', amount: 'oops' })] }),
      ),
    });

    await sync(deps);

    expect(addedRows(deps)).toEqual([
      expect.objectContaining({
        holdingId: 'h-bnb',
        amountMinorUnits: 4410,
        untrackedCounterpart: 'asset:PEPE',
        operation: 'dust',
      }),
    ]);
    expect(addedRows(deps)[0]?.exchangePairId).toBeUndefined();
    expect(addedRows(deps)[0]?.exchangeCounterpartHoldingId).toBeUndefined();
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
  });

  it('imports no row on a second run that reads the same records again', async () => {
    const { depsOf, sync, freshRun } = worldOf();
    const stored = new Set<string>();
    const deps = depsOf({
      fetchDustHistory: serverOf(dustRecordOf(), dustRecordOf({ transId: 'record-2' })),
      addTransactions: jest.fn(async (rows: { externalId: string }[]) => {
        const added = rows.filter(({ externalId }) => !stored.has(externalId));

        for (const { externalId } of added) {
          stored.add(externalId);
        }

        return added.length;
      }),
    });

    const first = await sync(deps, freshRun());
    const second = await sync(deps, freshRun());

    expect(first.imported).toBe(4);
    expect(second.imported).toBe(0);
    expect(stored.size).toBe(4);
  });

  it('rejects with the parse error and writes nothing when the body has no list', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () => {
        throw new BinanceHistoryParseError();
      }),
    });

    await expect(sync(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
  });

  it('does not set a cooldown on a failure that is not a rate limit', async () => {
    const { accountId, depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () => {
        throw new BinanceHistoryParseError();
      }),
    });

    await expect(sync(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);

    expect(isBinanceCoolingDown(accountId, NOW)).toBe(false);
  });

  it('writes and logs nothing for an empty list', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({ fetchDustHistory: serverOf() });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0 });
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('makes no request while the account is cooling down', async () => {
    const { accountId, depsOf, sync } = worldOf();
    setBinanceCooldownUntil(accountId, NOW + 60_000);
    const deps = depsOf();

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0 });
    expect(deps.fetchDustHistory).not.toHaveBeenCalled();
  });

  it('makes no request without credentials', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({ readCredentials: async () => undefined });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0 });
    expect(deps.fetchDustHistory).not.toHaveBeenCalled();
  });

  it('makes no request once the run has spent its one dust call', async () => {
    const { depsOf, sync, freshRun } = worldOf();
    const deps = depsOf({ fetchDustHistory: serverOf(dustRecordOf()) });
    const run = freshRun();

    await sync(deps, run);
    const second = await sync(deps, run);

    expect(second).toEqual({ imported: 0 });
    expect(deps.fetchDustHistory).toHaveBeenCalledTimes(1);
  });

  it('makes no request when the IP weight reading leaves no room for the call', async () => {
    const { depsOf, sync, freshRun } = worldOf();
    const run = freshRun();
    run.budget.record('market', { usedUidWeight1m: undefined, usedIpWeight1m: 6_000 });
    const deps = depsOf();

    await sync(deps, run);

    expect(deps.fetchDustHistory).not.toHaveBeenCalled();
  });

  it('reads once per run even when several records fail', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: serverOf(
        dustRecordOf({ transId: 'a', entries: [dustEntryOf({ amount: 'abc' })] }),
        dustRecordOf({ transId: 'b', entries: [dustEntryOf({ amount: 'abc' })] }),
      ),
    });

    await sync(deps);

    expect(deps.fetchDustHistory).toHaveBeenCalledTimes(1);
  });

  it('reads with the stored credentials and the run options', async () => {
    const { depsOf, sync } = worldOf();
    const fetchImpl = (async () => ({})) as unknown as typeof fetch;
    const deps = depsOf({ fetchImpl });

    await sync(deps);

    expect(deps.fetchDustHistory).toHaveBeenCalledWith('api-key', 'secret', {
      fetchImpl,
      now: deps.now,
    });
  });

  it('sets the cooldown from the rate limit and stops cleanly, writing and logging nothing', async () => {
    const { accountId, depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () => {
        throw new BinanceRateLimitError(429, 30_000);
      }),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0 });
    expect(isBinanceCoolingDown(accountId, NOW + 29_000)).toBe(true);
    expect(isBinanceCoolingDown(accountId, NOW + 30_000)).toBe(false);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs the missing holding and writes no row of the read, then imports once it exists', async () => {
    const { depsOf, sync, freshRun } = worldOf([]);
    const deps = depsOf({ fetchDustHistory: serverOf(dustRecordOf()) });

    const first = await sync(deps, freshRun());

    expect(first).toEqual({ imported: 0 });
    expect(stopCodes()).toEqual(['dust-holding-missing']);
    expect(deps.addTransactions).not.toHaveBeenCalled();

    const found = depsOf({
      fetchDustHistory: serverOf(dustRecordOf()),
      listHoldings: async () => SPOT_HOLDINGS,
    });
    const second = await sync(found, freshRun());

    expect(second).toEqual({ imported: 2 });
  });

  it('logs each stop code once per run, the unreadable records of the page included', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () =>
        dustPageOf(
          [
            dustRecordOf({
              transId: 'a',
              entries: [
                dustEntryOf({ amount: 'abc' }),
                dustEntryOf({ fromAsset: 'DOGE', amount: 'abc' }),
              ],
            }),
            dustRecordOf({ transId: 'b', entries: [dustEntryOf({ amount: '-1' })] }),
          ],
          { unreadable: [{ time: undefined }, { time: DUST_OPERATED_AT }] },
        ),
      ),
    });

    await sync(deps);

    expect([...stopCodes()].sort()).toEqual([
      'amount-malformed',
      'dust-amount-invalid',
      'dust-row-unreadable',
    ]);
  });

  it('imports the other entries and records when one entry or one record is refused', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () =>
        dustPageOf(
          [
            dustRecordOf({ transId: 'a', entries: [dustEntryOf({ amount: 'abc' })] }),
            dustRecordOf({ transId: 'b' }),
          ],
          { unreadable: [{ time: undefined }] },
        ),
      ),
    });

    const result = await sync(deps);

    expect(result.imported).toBe(2);
    expect(addedRows(deps).map(({ externalId }) => externalId.split(':')[2])).toEqual(['b', 'b']);
  });

  it('writes the oversized list before the rows and the untracked list after them', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: serverOf(
        dustRecordOf({
          entries: [
            dustEntryOf({ amount: '9007199254741' }),
            dustEntryOf({ fromAsset: 'PEPE' }),
            dustEntryOf({ fromAsset: 'DOGE', amount: '0.0002' }),
          ],
        }),
      ),
    });

    await sync(deps);

    const patchMock = deps.patchExchangeState as jest.Mock;
    const lists = patchMock.mock.calls.map(([, patches]) => patches[0].coins);
    const [oversizedAt, untrackedAt] = patchMock.mock.invocationCallOrder;
    const [addedAt] = (deps.addTransactions as jest.Mock).mock.invocationCallOrder;

    expect(lists).toEqual(['oversizedCoins', 'untrackedCoins']);
    expect(coinListPatchesOf(deps).map(({ tickers }) => tickers)).toEqual([['TRX'], ['PEPE']]);
    expect(oversizedAt).toBeLessThan(addedAt ?? 0);
    expect(addedAt).toBeLessThan(untrackedAt ?? 0);
  });

  it('writes no walk mark and no not-imported entry, only the two coin lists', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () =>
        dustPageOf(
          [
            dustRecordOf({
              entries: [
                dustEntryOf(),
                dustEntryOf({ fromAsset: 'PEPE' }),
                dustEntryOf({ fromAsset: 'DOGE', amount: 'abc' }),
                dustEntryOf({ fromAsset: 'BTC', amount: '9007199254741' }),
              ],
            }),
          ],
          { unreadable: [{ time: undefined }] },
        ),
      ),
    });

    await sync(deps);

    expect(new Set(patchKinds(deps))).toEqual(new Set(['coinList']));
  });

  it('writes no coin list and no row for a page of stopped and zero-unit entries, logging each code once', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: serverOf(
        dustRecordOf({
          entries: [
            dustEntryOf({ amount: '0' }),
            dustEntryOf({ fromAsset: 'DOGE', amount: 'abc' }),
            dustEntryOf({ fromAsset: 'PEPE', transferedAmount: '0' }),
          ],
        }),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 0 });
    expect(stopCodes()).toEqual(['amount-malformed']);
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });

  it('lists only the coins of the entries that name one, leaving a zero-unit entry out of both lists', async () => {
    const { depsOf, sync } = worldOf();
    const deps = depsOf({
      fetchDustHistory: serverOf(
        dustRecordOf({
          entries: [
            dustEntryOf({ amount: '0' }),
            dustEntryOf({ fromAsset: 'PEPE' }),
            dustEntryOf({ fromAsset: 'DOGE', amount: 'abc' }),
            dustEntryOf({ fromAsset: 'BTC', amount: '9007199254741' }),
          ],
        }),
      ),
    });

    const result = await sync(deps);

    expect(result).toEqual({ imported: 1 });
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'oversizedCoins', list: 'history', tickers: ['BTC'] },
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
    ]);
    expect([...stopCodes()].sort()).toEqual(['amount-malformed', 'amount-too-large']);
  });

  it.each([
    ['listing the holdings', 'listHoldings'],
    ['creating a missing holding', 'ensureHoldings'],
  ])(
    'rejects with a failure that is not a stop when %s fails, writing no row',
    async (_name, seam) => {
      const { depsOf, sync } = worldOf([]);
      const deps = depsOf({
        fetchDustHistory: serverOf(dustRecordOf()),
        [seam]: jest.fn(async () => {
          throw new Error('database unavailable');
        }),
      });

      await expect(sync(deps)).rejects.toThrow('database unavailable');

      expect(deps.addTransactions).not.toHaveBeenCalled();
      expect(stopCodes()).toEqual([]);
    },
  );

  it('reads the clock of the process when the deps give none', async () => {
    const { accountId, depsOf, sync } = worldOf();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const deps = depsOf({
      fetchDustHistory: jest.fn(async () => {
        throw new BinanceRateLimitError(429, 30_000);
      }),
    });
    const withoutClock = Object.fromEntries(
      Object.entries(deps).filter(([key]) => key !== 'now'),
    ) as Partial<BinanceDustHistoryDeps>;

    await sync(withoutClock as BinanceDustHistoryDeps);

    expect(isBinanceCoolingDown(accountId, NOW + 29_000)).toBe(true);
    expect(isBinanceCoolingDown(accountId, NOW + 30_000)).toBe(false);
    expect((deps.fetchDustHistory as jest.Mock).mock.calls[0]?.[2]?.now?.()).toBe(NOW);

    nowSpy.mockRestore();
  });
});
