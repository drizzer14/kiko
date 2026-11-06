import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { coinListPatchesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import {
  ACCOUNT_ID,
  type CapitalSeries,
  capitalWalkOf,
  readsOf,
  served,
} from './bybit.capital-test-fixtures';
import {
  NEVER_READ,
  depositRow,
  internalDepositRow,
  withdrawalRow,
} from './bybit.history-test-fixtures';
import { NOW } from './bybit.client-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;

// The page says an internal deposit's address is the sender's email, so the sentinel has its shape.
const SENTINEL_EMAIL = `${NEVER_READ}@example.com`;

const newWalk = (options: Partial<Parameters<typeof capitalWalkOf>[0]> = {}) =>
  capitalWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { capital: { cursor: CURSOR } } }),
    ...options,
  });

const depositAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(time, depositRow({ successAt: String(time), coin: 'BTC', amount: '0.5', ...overrides }));

const internalAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    internalDepositRow({
      createdTime: String(time / SECOND_MS),
      coin: 'BTC',
      amount: '0.25',
      ...overrides,
    }),
  );

const withdrawalAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    withdrawalRow({
      createTime: String(time),
      updateTime: String(time + SECOND_MS),
      coin: 'BTC',
      amount: '0.125',
      ...overrides,
    }),
  );

const pointAt = (time: number, series: CapitalSeries) => ({
  start: time - 1,
  end: time + 1,
  kind: 'point',
  series,
  since: NOW,
});

describe('the capital walk: what each row is', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('writes a deposit and an internal deposit as credits and a withdrawal as a debit, each keyed by account, kind, id and coin', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT)];
    walk.world.internal = [internalAt(AT + 2 * SECOND_MS)];
    walk.world.withdraw = [withdrawalAt(AT + 4 * SECOND_MS)];

    const result = await walk.run();

    expect(result.imported).toBe(3);
    expect(
      walk.rows().map(({ externalId, amountMinorUnits, description, time }) => ({
        externalId,
        amountMinorUnits,
        description,
        time,
      })),
    ).toEqual([
      {
        externalId: 'acc-1:deposit:1234:BTC',
        amountMinorUnits: 50_000_000,
        description: 'BTC',
        time: AT,
      },
      {
        externalId: 'acc-1:internal:5678:BTC',
        amountMinorUnits: 25_000_000,
        description: 'BTC',
        time: AT + 2 * SECOND_MS,
      },
      {
        externalId: 'acc-1:withdraw:9012:BTC',
        amountMinorUnits: -12_500_000,
        description: 'BTC',
        time: AT + 4 * SECOND_MS,
      },
    ]);
  });

  it('puts every row on the Funding holding of its coin, creating it at zero and leaving the Unified one alone', async () => {
    const walk = newWalk();
    walk.holdings.push({
      id: 'unified-btc',
      metadata: { bybitAsset: 'BTC:unified' },
    } as unknown as HoldingRow);
    walk.world.deposit = [depositAt(AT)];
    walk.world.withdraw = [withdrawalAt(AT + SECOND_MS, { coin: 'ETH' })];

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
      expect.objectContaining({ metadataKey: 'ETH:fund', currency: 'ETH' }),
    ]);
    expect(walk.rows().map((row) => row.holdingId)).toEqual([
      'holding-BTC:fund',
      'holding-ETH:fund',
    ]);
  });

  it('keeps the account in every key, so two accounts with one deposit id keep two rows', async () => {
    const first = newWalk();
    const second = newWalk({
      state: walkStateFake({ accountId: 'acc-2', marks: { capital: { cursor: CURSOR } } }),
    });
    first.world.deposit = [depositAt(AT)];
    second.world.deposit = [depositAt(AT)];

    await first.run();
    await second.run('acc-2');

    expect(first.keys()).toEqual(['acc-1:deposit:1234:BTC']);
    expect(second.keys()).toEqual(['acc-2:deposit:1234:BTC']);
  });

  describe('deposits', () => {
    const IMPORTING = [3, 70012];
    const WAITING = [0, 1, 2, 7, 70013, 10011, 10012, 99999];
    const OTHER_TYPES = ['10', '20', '7', undefined];

    it('imports only statuses 3 and 70012 with type 0, owes pending, unknown and types 10, 20, 7 and absent, ignores 4', async () => {
      const walk = newWalk();
      const cases = [
        ...IMPORTING.map((status) => ({
          id: `settled-${status}`,
          outcome: 'imported',
          fields: { status },
        })),
        { id: 'failed', outcome: 'ignored', fields: { status: 4 } },
        ...WAITING.map((status) => ({
          id: `waiting-${status}`,
          outcome: 'owed',
          fields: { status },
        })),
        ...OTHER_TYPES.flatMap((depositType) =>
          IMPORTING.map((status) => ({
            id: `type-${depositType}-${status}`,
            outcome: 'owed',
            fields: { status, depositType },
          })),
        ),
      ].map((entry, index) => ({ ...entry, time: AT + index * SECOND_MS }));
      walk.world.deposit = cases.map(({ id, fields, time }) => depositAt(time, { id, ...fields }));

      await walk.run();

      expect(walk.keys()).toEqual([
        'acc-1:deposit:settled-3:BTC',
        'acc-1:deposit:settled-70012:BTC',
      ]);
      expect(walk.marks().pending).toEqual(
        cases
          .filter(({ outcome }) => outcome === 'owed')
          .map(({ time }) => pointAt(time, 'deposit')),
      );
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('ignores a failed deposit whatever its type, one with no type included', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        depositAt(AT, { id: 'failed-0', status: 4 }),
        depositAt(AT + SECOND_MS, { id: 'failed-absent', status: 4, depositType: undefined }),
        depositAt(AT + 2 * SECOND_MS, { id: 'failed-20', status: 4, depositType: '20' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([]);
    });

    it('ignores a type 50 deposit whatever its status, with a time or none, and owes nothing for it', async () => {
      const walk = newWalk();
      const noTimeForms = ['', '0', undefined];
      walk.world.deposit = [
        ...[3, 0, 70012].map((status, index) =>
          depositAt(AT + index * SECOND_MS, { id: `status-${status}`, status, depositType: '50' }),
        ),
        ...noTimeForms.map((successAt, form) =>
          served(
            AT + (3 + form) * SECOND_MS,
            depositRow({
              id: `no-time-${form}`,
              coin: 'BTC',
              status: 3,
              depositType: '50',
              successAt,
            }),
          ),
        ),
      ];

      const result = await walk.run();

      expect(result.imported).toBe(0);
      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([]);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('reads a numeric type 0 as type 0', async () => {
      const walk = newWalk();
      walk.world.deposit = [depositAt(AT, { depositType: 0 })];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:deposit:1234:BTC']);
    });

    it('imports a settled deposit once, whatever the number of runs that read it', async () => {
      const walk = newWalk();
      walk.world.deposit = [depositAt(AT)];

      const first = await walk.run();
      const second = await walk.run();

      expect(first.imported).toBe(1);
      expect(second.imported).toBe(0);
      expect(walk.keys()).toHaveLength(1);
    });

    it('a rolled back deposit removes its row and moves no balance, with or with no time', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        depositAt(AT, { id: 'with-time' }),
        depositAt(AT + SECOND_MS, { id: 'no-time' }),
      ];
      await walk.run();
      walk.calls.length = 0;

      walk.world.deposit = [
        depositAt(AT, { id: 'with-time', status: 70011 }),
        depositAt(AT + 2 * SECOND_MS, { id: 'new' }),
        depositAt(AT + 3 * SECOND_MS, { id: 'waiting', status: 0 }),
        served(
          AT + SECOND_MS,
          depositRow({ id: 'no-time', status: 70011, successAt: '', coin: 'BTC' }),
        ),
      ];
      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:deposit:new:BTC']);
      expect(walk.deps.removeTransactions).toHaveBeenLastCalledWith([
        'acc-1:deposit:with-time:BTC',
        'acc-1:deposit:no-time:BTC',
      ]);
      expect(walk.calls.slice(0, 3)).toEqual(['add', 'remove', 'mark']);
      expect(walk.marks().pending).toEqual([pointAt(AT + 3 * SECOND_MS, 'deposit')]);
    });

    it('removes by key a deposit rolled back whose type is not 0, and owes nothing for it', async () => {
      const walk = newWalk();
      walk.world.deposit = [depositAt(AT, { status: 70011, depositType: '20' })];

      await walk.run();

      expect(walk.deps.removeTransactions).toHaveBeenCalledWith(['acc-1:deposit:1234:BTC']);
      expect(walk.marks().pending).toEqual([]);
    });

    it('owes a settled deposit whose amount is past the safe integer, and lists its coin', async () => {
      const walk = newWalk();
      walk.world.deposit = [depositAt(AT, { amount: '99999999999.99999999' })];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT, 'deposit')]);
      expect(coinListPatchesOf(walk.deps)).toContainEqual({
        kind: 'coinList',
        coins: 'oversizedCoins',
        list: 'history',
        tickers: ['BTC'],
      });
    });

    it('an over-precise amount owes its point and its neighbours import', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        depositAt(AT, { id: 'before' }),
        depositAt(AT + SECOND_MS, { id: 'precise', amount: '0.123456789' }),
        depositAt(AT + 2 * SECOND_MS, { id: 'malformed', amount: 'abc' }),
        depositAt(AT + 3 * SECOND_MS, { id: 'after' }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:deposit:before:BTC', 'acc-1:deposit:after:BTC']);
      expect(walk.marks().pending).toEqual([
        pointAt(AT + SECOND_MS, 'deposit'),
        pointAt(AT + 2 * SECOND_MS, 'deposit'),
      ]);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('a record in the second the span starts in owes only its point', async () => {
      const inTheStartSecond = CURSOR + 100;
      const walk = newWalk({
        state: walkStateFake({
          accountId: ACCOUNT_ID,
          marks: { capital: { cursor: CURSOR + 500 } },
        }),
        fake: { secondLevelStart: true },
      });
      walk.world.deposit = [depositAt(inTheStartSecond, { status: 0 })];

      await walk.run();

      expect(walk.marks().pending).toEqual([pointAt(inTheStartSecond, 'deposit')]);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('imports a settled deposit whose time is past the span end, and reads it as no drift', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        served(NOW - SECOND_MS, depositRow({ coin: 'BTC', successAt: String(NOW + DAY_MS) })),
      ];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:deposit:1234:BTC']);
      expect(walk.marks().cursor).toBe(NOW);
    });
  });

  describe('internal deposits', () => {
    it('imports status 2, ignores status 3, and owes status 1 and any other status at its time', async () => {
      const walk = newWalk();
      walk.world.internal = [
        internalAt(AT, { id: 'settled', status: 2 }),
        internalAt(AT + 2 * SECOND_MS, { id: 'failed', status: 3 }),
        internalAt(AT + 4 * SECOND_MS, { id: 'waiting', status: 1 }),
        internalAt(AT + 6 * SECOND_MS, { id: 'unknown', status: 9 }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:internal:settled:BTC']);
      expect(walk.marks().pending).toEqual([
        { ...pointAt(AT + 4 * SECOND_MS, 'internal'), end: AT + 5 * SECOND_MS },
        { ...pointAt(AT + 6 * SECOND_MS, 'internal'), end: AT + 7 * SECOND_MS },
      ]);
    });

    it('reads a time of ten digits as the whole second, from its first millisecond', async () => {
      const walk = newWalk();
      const second = AT + 4 * SECOND_MS;
      walk.world.internal = [internalAt(second, { id: 'waiting', status: 1 })];

      await walk.run();

      expect(walk.marks().pending).toEqual([
        {
          start: second - 1,
          end: second + SECOND_MS,
          kind: 'point',
          series: 'internal',
          since: NOW,
        },
      ]);
    });
  });

  describe('withdrawals', () => {
    const OWED = [
      'SecurityCheck',
      'Pending',
      'MoreInformationRequired',
      'Unknown',
      'BlockchainConfirmed',
      'SomethingNew',
    ];

    it('imports success, ignores CancelByUser, Reject and Fail, and owes every other status at its createTime', async () => {
      const walk = newWalk();
      const cases = [
        { id: 'done', status: 'success' },
        ...['CancelByUser', 'Reject', 'Fail'].map((status) => ({ id: status, status })),
        ...OWED.map((status) => ({ id: status, status })),
      ].map((entry, index) => ({ ...entry, time: AT + index * 2 * SECOND_MS }));
      walk.world.withdraw = cases.map(({ id, status, time }) =>
        withdrawalAt(time, { withdrawId: id, status }),
      );

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:withdraw:done:BTC']);
      expect(walk.marks().pending).toEqual(
        cases.slice(4).map(({ time }) => pointAt(time, 'withdraw')),
      );
    });

    it('a confirmed withdrawal stays owed until success', async () => {
      const walk = newWalk();
      walk.world.withdraw = [withdrawalAt(AT, { status: 'BlockchainConfirmed' })];

      await walk.run();
      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT, 'withdraw')]);

      walk.world.withdraw = [withdrawalAt(AT, { status: 'success' })];
      const settled = await walk.run();

      expect(settled.imported).toBe(1);
      expect(walk.keys()).toEqual(['acc-1:withdraw:9012:BTC']);
      expect(walk.marks().pending).toEqual([]);
    });

    it("a withdrawal row's time is its createTime, before and after it settles", async () => {
      const updated = AT + DAY_MS / 2;
      const walk = newWalk();
      const withdrawal = (status: string) =>
        withdrawalAt(AT, { createTime: String(AT), updateTime: String(updated), status });
      walk.world.withdraw = [withdrawal('Pending')];

      await walk.run();

      expect(walk.marks().pending).toEqual([pointAt(AT, 'withdraw')]);

      walk.world.withdraw = [withdrawal('success')];
      await walk.run();

      expect(walk.rows().map((row) => row.time)).toEqual([AT]);
    });

    it.each([
      ['11 digits', '17427289991'],
      ['12 digits', '174272899912'],
    ])(
      'imports a settled withdrawal whose updateTime has %s, at its createTime',
      async (_title, updateTime) => {
        const walk = newWalk();
        walk.world.withdraw = [withdrawalAt(AT, { updateTime })];

        const result = await walk.run();

        expect(result.imported).toBe(1);
        expect(walk.rows().map(({ externalId, time }) => ({ externalId, time }))).toEqual([
          { externalId: 'acc-1:withdraw:9012:BTC', time: AT },
        ]);
        expect(walk.marks().pending).toEqual([]);
      },
    );

    it('owes the span of a settled withdrawal with no createTime, in its own series, and the others go on', async () => {
      const walk = newWalk();
      walk.world.withdraw = [withdrawalAt(AT, { createTime: '', status: 'success' })];
      walk.world.deposit = [depositAt(AT + SECOND_MS)];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:deposit:1234:BTC']);
      expect(walk.marks().pending).toEqual([{ start: CURSOR, end: NOW, series: 'withdraw' }]);
      expect(walk.marks().cursor).toBe(NOW);
    });
  });

  describe('a record the walk cannot trust', () => {
    it('owes the point of a row that did not parse, and still imports its neighbours', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        depositAt(AT, { id: 'good' }),
        depositAt(AT + SECOND_MS, { id: '' }),
        depositAt(AT + 2 * SECOND_MS, { id: 'amount-not-text', amount: 5 }),
      ];

      await walk.run();

      expect(walk.keys()).toEqual(['acc-1:deposit:good:BTC']);
      expect(walk.marks().pending).toEqual([
        pointAt(AT + SECOND_MS, 'deposit'),
        pointAt(AT + 2 * SECOND_MS, 'deposit'),
      ]);
      expect(walk.marks().cursor).toBe(NOW);
    });

    it('owes the point of a row that names a coin the app does not track as a tracked row', async () => {
      const walk = newWalk({
        overrides: {
          fetchDepositPage: jest.fn(async (_apiKey, _secret, { span }) => ({
            nextPageCursor: undefined,
            rows:
              span.start <= AT && AT <= span.end
                ? [
                    {
                      kind: 'row' as const,
                      times: [AT],
                      row: {
                        id: 'odd',
                        coin: 'NOT-A-COIN',
                        amount: '1',
                        status: 3,
                        depositType: '0',
                        time: { start: AT, end: AT },
                      },
                    },
                  ]
                : [],
          })),
        },
      });

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT, 'deposit')]);
    });
  });

  describe('a coin the app does not track', () => {
    it('is counted and never read: no row, and its ticker is listed once the record is settled', async () => {
      const walk = newWalk();
      walk.world.deposit = [
        depositAt(AT, { id: 'listed', coin: 'ZZZ', status: 3, amount: 'not read' }),
        depositAt(AT + SECOND_MS, { id: 'waiting', coin: 'YYY', status: 1, amount: 'not read' }),
      ];
      walk.world.internal = [internalAt(AT + 2 * SECOND_MS, { coin: 'XXX', status: 2 })];
      walk.world.withdraw = [withdrawalAt(AT + 4 * SECOND_MS, { coin: 'WWW', status: 'success' })];

      await walk.run();

      expect(walk.keys()).toEqual([]);
      expect(walk.marks().pending).toEqual([]);
      expect(coinListPatchesOf(walk.deps)).toEqual([
        {
          kind: 'coinList',
          coins: 'untrackedCoins',
          list: 'history',
          tickers: ['ZZZ', 'XXX', 'WWW'],
        },
      ]);
    });
  });

  it('a counterparty field reaches no row, mark or log', async () => {
    const walk = newWalk();
    walk.world.deposit = [
      depositAt(AT, {
        id: 'good',
        fromAddress: NEVER_READ,
        toAddress: NEVER_READ,
        tag: NEVER_READ,
      }),
      depositAt(AT + SECOND_MS, { id: 'odd', status: 20, blockHash: NEVER_READ }),
      depositAt(AT + 2 * SECOND_MS, { id: '', toAddress: NEVER_READ }),
    ];
    walk.world.internal = [
      internalAt(AT + 3 * SECOND_MS, { address: SENTINEL_EMAIL, fromMemberId: NEVER_READ }),
    ];
    walk.world.withdraw = [
      withdrawalAt(AT + 5 * SECOND_MS, { toAddress: NEVER_READ, tag: NEVER_READ }),
    ];

    await walk.run();

    const everything = JSON.stringify([
      walk.rows(),
      (walk.deps.patchExchangeState as jest.Mock).mock.calls,
      warn.mock.calls,
    ]);

    expect(walk.keys()).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    expect(everything).not.toContain(NEVER_READ);
  });

  it('reads the three series of a span in one window, each from its own route', async () => {
    const walk = newWalk();

    await walk.run();

    expect(readsOf(walk.reads, 'deposit').map((read) => read.startTime)).toEqual([
      CURSOR,
      NOW - 29 * DAY_MS,
    ]);
    expect(readsOf(walk.reads, 'internal')).toHaveLength(2);
    expect(readsOf(walk.reads, 'withdraw')).toHaveLength(2);
  });
});
