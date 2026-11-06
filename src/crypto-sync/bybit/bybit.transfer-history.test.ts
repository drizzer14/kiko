import { DAY_MS } from '@kiko/dates';
import { coinListPatchesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID, served } from './bybit.capital-test-fixtures';
import { NEVER_READ, transferRow } from './bybit.history-test-fixtures';
import { transferAt, transferWalkOf } from './bybit.transfer-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;

const newWalk = (options: Partial<Parameters<typeof transferWalkOf>[0]> = {}) =>
  transferWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { transfer: { cursor: CURSOR } } }),
    ...options,
  });

const pointAt = (time: number) => ({
  start: time - 1,
  end: time + 1,
  kind: 'point',
  series: 'transfer',
  since: NOW,
});

const loggedCodes = (warn: jest.SpyInstance): unknown[] =>
  warn.mock.calls.map(([, details]) => (details as { code?: string }).code);

// Every row of these suites is built from the docs page's sample: no page with a row was read live.
describe('the transfer walk: what each row is', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('a transfer writes two legs that share one pair id', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT)];

    const result = await walk.run();

    expect(result.imported).toBe(2);
    expect(
      walk.rows().map((row) => ({
        externalId: row.externalId,
        holdingId: row.holdingId,
        amountMinorUnits: row.amountMinorUnits,
        time: row.time,
        exchangePairId: row.exchangePairId,
        exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId,
      })),
    ).toEqual([
      {
        externalId: 'acc-1:xfer:transfer-1:BTC:BTC:fund',
        holdingId: 'holding-BTC:fund',
        amountMinorUnits: -50_000_000,
        time: AT,
        exchangePairId: 'acc-1:xfer:transfer-1:BTC',
        exchangeCounterpartHoldingId: 'holding-BTC:unified',
      },
      {
        externalId: 'acc-1:xfer:transfer-1:BTC:BTC:unified',
        holdingId: 'holding-BTC:unified',
        amountMinorUnits: 50_000_000,
        time: AT,
        exchangePairId: 'acc-1:xfer:transfer-1:BTC',
        exchangeCounterpartHoldingId: 'holding-BTC:fund',
      },
    ]);
  });

  it('a transfer from Unified to Funding debits Unified and credits Funding', async () => {
    const walk = newWalk();
    walk.world.transfer = [
      transferAt(AT, { fromAccountType: 'UNIFIED', toAccountType: 'FUND', amount: '2' }),
    ];

    await walk.run();

    expect(
      walk.rows().map(({ holdingId, amountMinorUnits }) => [holdingId, amountMinorUnits]),
    ).toEqual([
      ['holding-BTC:unified', -200_000_000],
      ['holding-BTC:fund', 200_000_000],
    ]);
  });

  it('creates the two holdings of the coin at zero, with their default names', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT)];

    await walk.run();

    expect(walk.deps.ensureHoldings).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        name: 'Bybit Funding · BTC',
        type: 'crypto_asset',
        currency: 'BTC',
        balanceMinorUnits: 0,
        metadataField: 'bybitAsset',
        metadataKey: 'BTC:fund',
      }),
      expect.objectContaining({
        name: 'Bybit Unified · BTC',
        balanceMinorUnits: 0,
        metadataKey: 'BTC:unified',
      }),
    ]);
  });

  it('adds the coin to the pair id, so two coins that share one transfer id keep two pairs', async () => {
    const walk = newWalk();
    walk.world.transfer = [
      transferAt(AT, { transferId: 'shared' }),
      transferAt(AT + SECOND_MS, { transferId: 'shared', coin: 'ETH', amount: '1' }),
    ];

    await walk.run();

    expect(walk.keys()).toEqual([
      'acc-1:xfer:shared:BTC:BTC:fund',
      'acc-1:xfer:shared:BTC:BTC:unified',
      'acc-1:xfer:shared:ETH:ETH:fund',
      'acc-1:xfer:shared:ETH:ETH:unified',
    ]);
    expect([...new Set(walk.rows().map((row) => row.exchangePairId))]).toEqual([
      'acc-1:xfer:shared:BTC',
      'acc-1:xfer:shared:ETH',
    ]);
  });

  it('keeps the account in every key, so two accounts with one transfer id keep two pairs', async () => {
    const first = newWalk();
    const second = newWalk({
      state: walkStateFake({ accountId: 'acc-2', marks: { transfer: { cursor: CURSOR } } }),
    });
    first.world.transfer = [transferAt(AT)];
    second.world.transfer = [transferAt(AT)];

    await first.run();
    await second.run('acc-2');

    expect(first.rows().map((row) => row.exchangePairId)).toEqual([
      'acc-1:xfer:transfer-1:BTC',
      'acc-1:xfer:transfer-1:BTC',
    ]);
    expect(second.rows().map((row) => row.exchangePairId)).toEqual([
      'acc-2:xfer:transfer-1:BTC',
      'acc-2:xfer:transfer-1:BTC',
    ]);
  });

  it('imports a settled transfer once, whatever the number of runs that read it', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT)];

    await walk.run();
    walk.clock.now = NOW + DAY_MS;
    const second = await walk.run();

    expect(second.imported).toBe(0);
    expect(walk.keys()).toHaveLength(2);
  });

  describe('statuses', () => {
    it('imports SUCCESS, ignores FAILED, and owes PENDING and any other status at its time', async () => {
      const walk = newWalk();
      walk.world.transfer = [
        transferAt(AT, { transferId: 'ok', status: 'SUCCESS' }),
        transferAt(AT + SECOND_MS, { transferId: 'failed', status: 'FAILED' }),
        transferAt(AT + 2 * SECOND_MS, { transferId: 'pending', status: 'PENDING' }),
        transferAt(AT + 3 * SECOND_MS, { transferId: 'unknown', status: 'REVIEWING' }),
        transferAt(AT + 4 * SECOND_MS, { transferId: 'lower', status: 'success' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:xfer:ok:BTC:BTC:fund', 'acc-1:xfer:ok:BTC:BTC:unified']);
      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.marks().pending).toEqual([
        pointAt(AT + 2 * SECOND_MS),
        pointAt(AT + 3 * SECOND_MS),
        pointAt(AT + 4 * SECOND_MS),
      ]);
      expect(loggedCodes(warn)).toEqual(['transfer-not-settled']);
    });

    it('a failed transfer owes nothing, whatever its wallets and whether or not it has a time', async () => {
      const walk = newWalk();
      walk.world.transfer = [
        transferAt(AT, { transferId: 'wallet', status: 'FAILED', fromAccountType: 'SPOT' }),
        transferAt(AT + SECOND_MS, { transferId: 'no-time', status: 'FAILED', timestamp: '' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks()).toEqual({ cursor: NOW, pending: [] });
      expect(warn).not.toHaveBeenCalled();
    });

    it('a pending transfer is imported once a later read shows it settled', async () => {
      const walk = newWalk();
      walk.world.transfer = [transferAt(AT, { status: 'PENDING' })];
      await walk.run();

      walk.world.transfer = [transferAt(AT, { status: 'SUCCESS' })];
      walk.clock.now = NOW + DAY_MS;
      const second = await walk.run();

      expect(second.imported).toBe(2);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  describe('wallets', () => {
    it('an unknown wallet owes its point and holds no cursor', async () => {
      const walk = newWalk();
      walk.world.transfer = [
        transferAt(AT, { transferId: 'sample', fromAccountType: 'SPOT', toAccountType: 'UNIFIED' }),
        transferAt(AT + SECOND_MS, {
          transferId: 'to-unknown',
          fromAccountType: 'UNIFIED',
          toAccountType: 'CONTRACT',
        }),
        transferAt(AT + 2 * SECOND_MS, { transferId: 'lower', fromAccountType: 'fund' }),
        transferAt(AT + 3 * SECOND_MS, { transferId: 'neighbour' }),
      ];

      const result = await walk.run();

      expect(result.imported).toBe(2);
      expect(walk.keys()).toEqual([
        'acc-1:xfer:neighbour:BTC:BTC:fund',
        'acc-1:xfer:neighbour:BTC:BTC:unified',
      ]);
      expect(walk.marks().cursor).toBe(NOW);
      expect(walk.marks().pending).toEqual([
        pointAt(AT),
        pointAt(AT + SECOND_MS),
        pointAt(AT + 2 * SECOND_MS),
      ]);
      expect(loggedCodes(warn)).toEqual(['bybit-transfer-wallet-unknown']);
    });

    it('an unknown wallet is read again on every run, for one call, while it stays owed', async () => {
      const walk = newWalk();
      walk.world.transfer = [transferAt(AT, { fromAccountType: 'SPOT' })];
      await walk.run();
      walk.reads.length = 0;
      walk.clock.now = NOW + 20 * DAY_MS;

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.reads.filter((read) => read.startTime < NOW - DAY_MS)).toHaveLength(1);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
    });

    it('a transfer from a wallet to itself owes its point and writes no leg', async () => {
      const walk = newWalk();
      walk.world.transfer = [
        transferAt(AT, { fromAccountType: 'UNIFIED', toAccountType: 'UNIFIED' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(loggedCodes(warn)).toEqual(['transfer-row-unreadable']);
    });
  });

  describe('a record the walk cannot trust', () => {
    it.each([
      ['zero', '0', 'transfer-amount-invalid'],
      ['negative', '-5', 'transfer-amount-invalid'],
      ['not a number', 'a lot', 'amount-malformed'],
      ['over-precise', '0.123456789', 'amount-precision'],
    ])(
      'an amount that is %s owes its point and its neighbour imports',
      async (_name, amount, code) => {
        const walk = newWalk();
        walk.world.transfer = [
          transferAt(AT, { transferId: 'bad', amount }),
          transferAt(AT + SECOND_MS, { transferId: 'good' }),
        ];

        await walk.run();

        expect(walk.keys()).toEqual([
          'acc-1:xfer:good:BTC:BTC:fund',
          'acc-1:xfer:good:BTC:BTC:unified',
        ]);
        expect(walk.marks().pending).toEqual([pointAt(AT)]);
        expect(walk.marks().cursor).toBe(NOW);
        expect(loggedCodes(warn)).toEqual([code]);
      },
    );

    it('owes the point of a row that did not parse, and still imports its neighbours', async () => {
      const walk = newWalk();
      walk.world.transfer = [
        served(AT, transferRow({ transferId: undefined, timestamp: String(AT), coin: 'BTC' })),
        transferAt(AT + SECOND_MS, { transferId: 'good' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([
        'acc-1:xfer:good:BTC:BTC:fund',
        'acc-1:xfer:good:BTC:BTC:unified',
      ]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(loggedCodes(warn)).toEqual(['transfer-row-unreadable']);
    });
  });

  describe('a coin the app does not track', () => {
    it('is counted and never read: no row, and its ticker is listed once the transfer is settled', async () => {
      const walk = newWalk();
      walk.world.transfer = [
        transferAt(AT, { transferId: 'settled', coin: 'PEPE', amount: 'not read' }),
        transferAt(AT + SECOND_MS, { transferId: 'pending', coin: 'SHIB', status: 'PENDING' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(coinListPatchesOf(walk.deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['PEPE'] },
      ]);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  it('a counterparty field reaches no row, mark or log', async () => {
    const walk = newWalk();
    walk.world.transfer = [
      transferAt(AT, { fromUserId: NEVER_READ, toUserId: NEVER_READ, note: NEVER_READ }),
    ];

    await walk.run();

    const written = JSON.stringify([
      walk.rows(),
      walk.marks(),
      (walk.deps.patchExchangeState as jest.Mock).mock.calls,
      warn.mock.calls,
    ]);

    expect(written).not.toContain(NEVER_READ);
  });
});
