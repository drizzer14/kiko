import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import { i18n } from '@kiko/i18n/init';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import {
  EARN_FAILED_STATUSES,
  EARN_FLOOR_MS,
  EARN_FORWARD_OWES,
  EARN_REDEMPTION_SETTLED_STATUS,
  EARN_SERIES,
  EARN_SUBSCRIPTION_SETTLED_STATUS,
  EARN_WINDOW_MS,
  redemptionRowsOf,
  subscriptionRowsOf,
} from './binance.earn-history';
import {
  agoMs,
  entryOf,
  flexibleRedemptionOf,
  flexibleRewardOf,
  flexibleSubscriptionOf,
  freshRun,
  fullPage,
  idsOf,
  listOf,
  lockedRedemptionOf,
  lockedRewardOf,
  lockedSubscriptionOf,
  pageOf,
  pointOf,
  pointsIn,
  SPOT_FIELDS,
  stopCodeOf,
  stopCodes,
  unreadableEntryOf,
  walkOnce,
  worldOf,
} from './binance.earn-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceRateLimitError } from './binance.client';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { COSTS, LANE_CALL_CAPS } from './binance.history-budget';
import { EARN_KEY, FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

const ACCOUNT = 'acc-1';
const SATOSHIS = 100_000;
const CAP = LANE_CALL_CAPS.earn;
const KIND_COUNT = EARN_SERIES.length;

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the Earn walk constants', () => {
  it('reads windows of 30 days from the first day of 2022, the kinds most likely to be dense first', () => {
    expect(EARN_WINDOW_MS).toBe(30 * DAY_MS);
    expect(EARN_FLOOR_MS).toBe(Date.UTC(2022, 0, 1));
    expect(EARN_SERIES).toEqual([
      'flexibleRewards',
      'lockedRewards',
      'flexibleSubscription',
      'flexibleRedemption',
      'lockedSubscription',
      'lockedRedemption',
    ]);
  });

  it('settles a subscription on SUCCESS and a redemption on PAID, and ignores FAILED', () => {
    expect(EARN_SUBSCRIPTION_SETTLED_STATUS).toBe('SUCCESS');
    expect(EARN_REDEMPTION_SETTLED_STATUS).toBe('PAID');
    expect(EARN_FAILED_STATUSES).toEqual(['FAILED']);
  });

  it('owes and goes past in the forward pass every stop of one record, and no stop of the span as a whole', () => {
    expect([...EARN_FORWARD_OWES].sort()).toEqual([
      'earn-account-unknown',
      'earn-amount-invalid',
      'earn-id-missing',
      'earn-not-settled',
      'earn-redemption-type-unconfirmed',
      'earn-reward-type-unknown',
      'earn-row-unreadable',
      'earn-split-mismatch',
      'earn-subscription-type-unconfirmed',
    ]);
    expect(EARN_FORWARD_OWES).not.toContain('earn-page-drift');
    expect(EARN_FORWARD_OWES).not.toContain('earn-holding-missing');
  });
});

describe('subscriptionRowsOf', () => {
  const rowsOf = (
    over: Parameters<typeof flexibleSubscriptionOf>[0] = {},
    product: 'flexible' | 'locked' = 'flexible',
  ) =>
    product === 'flexible'
      ? subscriptionRowsOf(ACCOUNT, 'flexible', flexibleSubscriptionOf(over))
      : subscriptionRowsOf(ACCOUNT, 'locked', lockedSubscriptionOf(over));

  it('E1: a flexible subscription paid from Spot is Spot -a and Earn +a, each leg naming the other wallet, one pair id', () => {
    expect(rowsOf()).toEqual([
      {
        wallet: SPOT_KEY,
        counterpartWallet: EARN_KEY,
        amountMinorUnits: -SATOSHIS,
        time: agoMs(2),
        externalId: 'acc-1:earn:sub:flexible:p-1:BTC',
        exchangePairId: 'acc-1:earn:sub:flexible:p-1',
        description: '',
      },
      {
        wallet: EARN_KEY,
        counterpartWallet: SPOT_KEY,
        amountMinorUnits: SATOSHIS,
        time: agoMs(2),
        externalId: 'acc-1:earn:sub:flexible:p-1:BTC:earn',
        exchangePairId: 'acc-1:earn:sub:flexible:p-1',
        description: '',
      },
    ]);
  });

  it('E2: a locked subscription of 0.3 from Spot and 0.2 from Funding is three legs and one pair id, the Earn leg naming the larger debit', () => {
    const rows = rowsOf({ amount: '0.5', amtFromSpot: '0.3', amtFromFunding: '0.2' }, 'locked');

    expect(rows.map((row) => [row.wallet, row.amountMinorUnits, row.counterpartWallet])).toEqual([
      [SPOT_KEY, -30_000_000, EARN_KEY],
      [FUNDING_KEY, -20_000_000, EARN_KEY],
      [EARN_KEY, 50_000_000, SPOT_KEY],
    ]);
    expect(new Set(rows.map((row) => row.exchangePairId))).toEqual(
      new Set(['acc-1:earn:sub:locked:p-1']),
    );
  });

  it.each([
    ['Funding is the larger debit', '0.2', '0.3', FUNDING_KEY],
    ['the two debits are equal: Spot', '0.25', '0.25', SPOT_KEY],
  ])(
    'E2: the Earn leg names Funding or Spot by the larger debit: %s',
    (_label, spot, funding, named) => {
      const rows = rowsOf({ amount: '0.5', amtFromSpot: spot, amtFromFunding: funding });

      expect(rows.find((row) => row.wallet === EARN_KEY)?.counterpartWallet).toBe(named);
    },
  );

  it('E4: with no split fields, sourceAccount FUNDING takes the whole amount from Funding', () => {
    const rows = rowsOf({
      amtFromSpot: undefined,
      amtFromFunding: undefined,
      sourceAccount: 'FUNDING',
    });

    expect(rows.map((row) => [row.wallet, row.amountMinorUnits, row.counterpartWallet])).toEqual([
      [FUNDING_KEY, -SATOSHIS, EARN_KEY],
      [EARN_KEY, SATOSHIS, FUNDING_KEY],
    ]);
  });

  it('takes the whole amount from Spot for sourceAccount SPOT, with no split fields', () => {
    const rows = rowsOf({
      amtFromSpot: undefined,
      amtFromFunding: undefined,
      sourceAccount: 'SPOT',
    });

    expect(rows.map((row) => row.wallet)).toEqual([SPOT_KEY, EARN_KEY]);
  });

  it.each([['MARGIN'], [undefined]])(
    'stops a subscription with no split fields whose sourceAccount is %p: it is neither SPOT nor FUNDING',
    (sourceAccount) => {
      expect(
        stopCodeOf(() =>
          rowsOf({ amtFromSpot: undefined, amtFromFunding: undefined, sourceAccount }),
        ),
      ).toBe('earn-account-unknown');
    },
  );

  it('E3: a subscription whose split is not its amount is a stop', () => {
    expect(
      stopCodeOf(() => rowsOf({ amount: '0.5', amtFromSpot: '0.3', amtFromFunding: '0.1' })),
    ).toBe('earn-split-mismatch');
    expect(stopCodeOf(() => rowsOf({ amtFromSpot: '0', amtFromFunding: '0' }))).toBe(
      'earn-split-mismatch',
    );
  });

  it('reads a split field that is left out as zero', () => {
    const rows = rowsOf({ amtFromSpot: undefined, amtFromFunding: '0.001' });

    expect(rows.map((row) => row.wallet)).toEqual([FUNDING_KEY, EARN_KEY]);
  });

  it.each([['x'], ['-0.001']])(
    'stops a subscription whose split field is %p: it is no amount of satoshis',
    (split) => {
      expect(stopCodeOf(() => rowsOf({ amtFromSpot: split }))).toBe('earn-amount-invalid');
    },
  );

  it('E21: a FAILED subscription is ignored: no row, and nothing owed', () => {
    expect(rowsOf({ status: 'FAILED' })).toEqual([]);
  });

  it('E14: a status that is neither SUCCESS nor FAILED is not settled', () => {
    for (const status of ['PENDING', '', 'success', 'PROCESS']) {
      expect(stopCodeOf(() => rowsOf({ status }))).toBe('earn-not-settled');
    }
  });

  it('a subscription with status PAID is not settled: PAID is a redemption status', () => {
    expect(stopCodeOf(() => rowsOf({ status: 'PAID' }))).toBe('earn-not-settled');
    expect(stopCodeOf(() => rowsOf({ status: 'PAID' }, 'locked'))).toBe('earn-not-settled');
  });

  it.each([['CONVERT'], ['TRANSFER']])(
    'a flexible subscription of type %s (documented as from the locked product) is a stop: its money may not have come from the wallet it names',
    (type) => {
      expect(stopCodeOf(() => rowsOf({ type }))).toBe('earn-subscription-type-unconfirmed');
    },
  );

  it.each([['NORMAL'], ['AUTO'], ['LOAN'], ['AI'], ['X'], [undefined]])(
    'a flexible subscription of type %p is the money of its wallet: Spot -a and Earn +a',
    (type) => {
      expect(rowsOf({ type }).map((row) => [row.wallet, row.amountMinorUnits])).toEqual([
        [SPOT_KEY, -SATOSHIS],
        [EARN_KEY, SATOSHIS],
      ]);
    },
  );

  it('a locked subscription of type CONVERT writes as before: only a flexible one is read by type', () => {
    expect(rowsOf({ type: 'CONVERT' }, 'locked')).toHaveLength(2);
  });

  it('stops a settled subscription with no id', () => {
    expect(stopCodeOf(() => rowsOf({ purchaseId: '' }))).toBe('earn-id-missing');
  });

  it.each([['0'], ['0.00000000'], ['-0.5'], ['x'], ['']])(
    'stops a settled subscription whose amount is %p: it is no positive number of satoshis',
    (amount) => {
      expect(stopCodeOf(() => rowsOf({ amount }))).toBe('earn-amount-invalid');
    },
  );

  it('keys a flexible and a locked subscription of one purchase id apart, and two accounts apart', () => {
    const flexible = rowsOf({}, 'flexible').map((row) => row.externalId);
    const locked = rowsOf({}, 'locked').map((row) => row.externalId);
    const other = subscriptionRowsOf('acc-2', 'flexible', flexibleSubscriptionOf());

    expect(flexible.filter((key) => locked.includes(key))).toEqual([]);
    expect(other[0].externalId).toBe('acc-2:earn:sub:flexible:p-1:BTC');
  });
});

describe('redemptionRowsOf', () => {
  it('E5: a flexible redemption to Spot is Earn -a and Spot +a, each leg naming the other wallet, one pair id', () => {
    expect(redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf())).toEqual([
      {
        wallet: EARN_KEY,
        counterpartWallet: SPOT_KEY,
        amountMinorUnits: -SATOSHIS,
        time: agoMs(2),
        externalId: 'acc-1:earn:redeem:flexible:r-1:BTC:earn',
        exchangePairId: 'acc-1:earn:redeem:flexible:r-1',
        description: '',
      },
      {
        wallet: SPOT_KEY,
        counterpartWallet: EARN_KEY,
        amountMinorUnits: SATOSHIS,
        time: agoMs(2),
        externalId: 'acc-1:earn:redeem:flexible:r-1:BTC',
        exchangePairId: 'acc-1:earn:redeem:flexible:r-1',
        description: '',
      },
    ]);
  });

  it('a flexible redemption to Funding puts the credit on Funding', () => {
    const rows = redemptionRowsOf(
      ACCOUNT,
      'flexible',
      flexibleRedemptionOf({ destAccount: 'FUNDING' }),
    );

    expect(rows.map((row) => row.wallet)).toEqual([EARN_KEY, FUNDING_KEY]);
  });

  it.each([['MARGIN'], [undefined]])(
    'stops a flexible redemption whose destAccount is %p',
    (destAccount) => {
      expect(
        stopCodeOf(() =>
          redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf({ destAccount })),
        ),
      ).toBe('earn-account-unknown');
    },
  );

  it('E6: a locked redemption is the principal alone, to Spot: its reward comes from the rewards record', () => {
    const rows = redemptionRowsOf(
      ACCOUNT,
      'locked',
      lockedRedemptionOf({ amount: '0.002', originalAmount: '0.0021' }),
    );

    expect(rows.map((row) => [row.wallet, row.amountMinorUnits])).toEqual([
      [EARN_KEY, -200_000],
      [SPOT_KEY, 200_000],
    ]);
    expect(rows[0].exchangePairId).toBe('acc-1:earn:redeem:locked:r-1');
  });

  it('E5/E6: a flexible and a locked redemption with status PAID write Earn -a and the destination +a', () => {
    const flexible = redemptionRowsOf(
      ACCOUNT,
      'flexible',
      flexibleRedemptionOf({ status: 'PAID', destAccount: 'SPOT' }),
    );
    const locked = redemptionRowsOf(
      ACCOUNT,
      'locked',
      lockedRedemptionOf({ status: 'PAID', type: 'MATURE', isComplete: true }),
    );

    for (const rows of [flexible, locked]) {
      expect(rows.map((row) => [row.wallet, row.amountMinorUnits])).toEqual([
        [EARN_KEY, -SATOSHIS],
        [SPOT_KEY, SATOSHIS],
      ]);
    }
  });

  it('a redemption with status SUCCESS is not settled: SUCCESS is a subscription status', () => {
    expect(
      stopCodeOf(() =>
        redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf({ status: 'SUCCESS' })),
      ),
    ).toBe('earn-not-settled');
    expect(
      stopCodeOf(() =>
        redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ status: 'SUCCESS' })),
      ),
    ).toBe('earn-not-settled');
  });

  it('E21: a FAILED redemption is ignored; one neither PAID nor FAILED (CREATED, PROCESS) is not settled', () => {
    expect(
      redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf({ status: 'FAILED' })),
    ).toEqual([]);
    expect(redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ status: 'FAILED' }))).toEqual(
      [],
    );

    for (const status of ['CREATED', 'PROCESS', '', 'paid']) {
      expect(
        stopCodeOf(() => redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf({ status }))),
      ).toBe('earn-not-settled');
      expect(
        stopCodeOf(() => redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ status }))),
      ).toBe('earn-not-settled');
    }
  });

  it('a locked redemption with isComplete false is not settled, even when its status is PAID', () => {
    expect(
      stopCodeOf(() =>
        redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ isComplete: false })),
      ),
    ).toBe('earn-not-settled');
  });

  it.each([[true], [undefined]])(
    'a locked redemption with isComplete %p (true, or left out) is settled by its status alone',
    (isComplete) => {
      expect(redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ isComplete }))).toHaveLength(
        2,
      );
    },
  );

  it('a FAILED locked redemption with isComplete false is ignored: nothing is owed for it', () => {
    expect(
      redemptionRowsOf(
        ACCOUNT,
        'locked',
        lockedRedemptionOf({ status: 'FAILED', isComplete: false }),
      ),
    ).toEqual([]);
  });

  it('MATURE is the one locked redemption type that is placed: principal Earn -a, Spot +a', () => {
    expect(
      redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ type: 'MATURE' })).map((row) => [
        row.wallet,
        row.amountMinorUnits,
      ]),
    ).toEqual([
      [EARN_KEY, -SATOSHIS],
      [SPOT_KEY, SATOSHIS],
    ]);
  });

  it.each([['NEW_TRANSFERRED'], ['AHEAD'], ['X'], [''], ['mature'], [undefined]])(
    'a locked redemption of type %p is a stop: the record names no destination, so none is assumed',
    (type) => {
      expect(
        stopCodeOf(() => redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ type }))),
      ).toBe('earn-redemption-type-unconfirmed');
    },
  );

  it('a FAILED locked redemption of an unconfirmed type is ignored, and a flexible redemption has no type to read', () => {
    expect(
      redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ status: 'FAILED', type: 'AHEAD' })),
    ).toEqual([]);
    expect(
      redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf()).map((row) => row.wallet),
    ).toEqual([EARN_KEY, SPOT_KEY]);
  });

  it('stops a redemption with no id or no positive amount', () => {
    expect(
      stopCodeOf(() =>
        redemptionRowsOf(ACCOUNT, 'flexible', flexibleRedemptionOf({ redeemId: '' })),
      ),
    ).toBe('earn-id-missing');
    expect(
      stopCodeOf(() => redemptionRowsOf(ACCOUNT, 'locked', lockedRedemptionOf({ amount: '0' }))),
    ).toBe('earn-amount-invalid');
  });
});

describe('the rows of a settled record, written', () => {
  const cursorBehind = { [SPOT_FIELDS.cursor]: agoMs(5) };

  it('E1: writes Spot -a and Earn +a, each leg naming the other holding, out of spending, labelled "Transfer to/from"', async () => {
    const world = worldOf(cursorBehind);

    const { result } = await walkOnce({
      world,
      entries: [entryOf('flexibleSubscription', flexibleSubscriptionOf())],
    });

    expect(result).toEqual({ imported: 2, complete: true });
    expect(world.added).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: -SATOSHIS,
        time: agoMs(2),
        source: 'binance',
        externalId: 'acc-1:earn:sub:flexible:p-1:BTC',
        exchangeCounterpartHoldingId: 'h-earn',
        exchangePairId: 'acc-1:earn:sub:flexible:p-1',
        description: '',
      },
      {
        holdingId: 'h-earn',
        amountMinorUnits: SATOSHIS,
        time: agoMs(2),
        source: 'binance',
        externalId: 'acc-1:earn:sub:flexible:p-1:BTC:earn',
        exchangeCounterpartHoldingId: 'h-spot',
        exchangePairId: 'acc-1:earn:sub:flexible:p-1',
        description: '',
      },
    ]);

    const stored = world.added.map((row) => ({
      id: row.externalId,
      exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId ?? null,
      untrackedCounterpart: null,
    }));
    expect(exchangeExcludedTransactionIds(stored)).toEqual(new Set(stored.map((row) => row.id)));

    const names = new Map([
      ['h-spot', 'Binance Spot'],
      ['h-earn', 'Binance Earn'],
    ]);
    const currencies = new Map([
      ['h-spot', 'BTC'],
      ['h-earn', 'BTC'],
    ]);
    const [spent, received] = world.added.map((row) =>
      transactionRowDescription({
        transaction: {
          holdingId: row.holdingId,
          description: row.description,
          amountMinorUnits: row.amountMinorUnits,
          exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId ?? null,
          untrackedCounterpart: null,
        },
        holdingName: names.get(row.holdingId) ?? '',
        holdingNameById: names,
        holdingCurrencyById: currencies,
        t: i18n.t,
      }),
    );
    expect(spent).toBe('Transfer to Binance Earn');
    expect(received).toBe('Transfer from Binance Spot');
  });

  it('E2: a locked subscription from Spot and Funding is three rows on three holdings, the Earn leg naming Spot', async () => {
    const world = worldOf(cursorBehind);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'lockedSubscription',
          lockedSubscriptionOf({ amount: '0.5', amtFromSpot: '0.3', amtFromFunding: '0.2' }),
        ),
      ],
    });

    expect(
      world.added.map((row) => [
        row.holdingId,
        row.amountMinorUnits,
        row.exchangeCounterpartHoldingId,
      ]),
    ).toEqual([
      ['h-spot', -30_000_000, 'h-earn'],
      ['h-funding', -20_000_000, 'h-earn'],
      ['h-earn', 50_000_000, 'h-spot'],
    ]);
  });

  it('E5: a flexible redemption to Spot is Earn -a and Spot +a', async () => {
    const world = worldOf(cursorBehind);

    await walkOnce({ world, entries: [entryOf('flexibleRedemption', flexibleRedemptionOf())] });

    expect(world.added.map((row) => [row.holdingId, row.amountMinorUnits])).toEqual([
      ['h-earn', -SATOSHIS],
      ['h-spot', SATOSHIS],
    ]);
  });

  it('E18: creates the missing Earn holding at zero first, then writes the reward on it', async () => {
    const world = worldOf(cursorBehind, []);

    const { deps } = await walkOnce({
      world,
      entries: [entryOf('flexibleRewards', flexibleRewardOf())],
    });

    expect(deps.ensureHoldings).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: 'acc-1', metadataKey: EARN_KEY, balanceMinorUnits: 0 }),
    ]);
    expect(world.added.map((row) => row.holdingId)).toEqual(['created-BTC:earn']);
  });

  it('E10: writes the same keys again on a second identical run, for the deduping import to refresh', async () => {
    const world = worldOf(cursorBehind);
    const entries = [
      entryOf('flexibleSubscription', flexibleSubscriptionOf()),
      entryOf('lockedRewards', lockedRewardOf()),
    ];

    await walkOnce({ world, entries });
    const first = idsOf(world);
    world.added = [];
    world.metadata = { ...world.metadata, ...cursorBehind };
    await walkOnce({ world, entries });

    expect(idsOf(world)).toEqual(first);
  });

  it('E21: a FAILED subscription writes nothing and owes nothing, and the run is complete', async () => {
    const world = worldOf(cursorBehind);

    const { result } = await walkOnce({
      world,
      entries: [
        entryOf(
          'flexibleSubscription',
          flexibleSubscriptionOf({ status: 'FAILED', time: agoMs(10) }),
        ),
      ],
    });

    expect(world.added).toEqual([]);
    expect(pointsIn(listOf(world))).toEqual([]);
    expect(result.complete).toBe(true);
    expect(stopCodes(warn)).toEqual([]);
  });

  it('writes nothing for an account with no Spot holding or no credentials', async () => {
    const noSpot = await walkOnce({ world: worldOf(), over: { listHoldings: async () => [] } });
    const noKeys = await walkOnce({
      world: worldOf(),
      over: { readCredentials: async () => undefined },
    });

    expect(noSpot.requests).toEqual([]);
    expect(noKeys.requests).toEqual([]);
    expect(noSpot.result).toEqual({ imported: 0, complete: true });
    expect(noKeys.result).toEqual({ imported: 0, complete: true });
  });
});

describe('where the walk starts and what it never asks', () => {
  it('starts the first window on 1 January 2022, and never before it, whatever the stored marks say', async () => {
    const world = worldOf({
      [SPOT_FIELDS.cursor]: HISTORY_FLOOR_MS,
      [SPOT_FIELDS.rescan]: HISTORY_FLOOR_MS,
      [SPOT_FIELDS.pending]: [
        { start: HISTORY_FLOOR_MS, end: HISTORY_FLOOR_MS + DAY_MS },
        pointOf(HISTORY_FLOOR_MS + 5 * DAY_MS, 'flexibleRewards'),
      ],
    });

    const { requests } = await walkOnce({ world });

    expect(requests[0].startTime).toBe(EARN_FLOOR_MS);
    expect(minOf(requests.map((request) => request.startTime))).toBe(EARN_FLOOR_MS);
  });

  it.each([
    ['no mark at all', {}],
    ['an old re-scan mark behind a recent forward cursor', { [SPOT_FIELDS.rescan]: agoMs(2000) }],
    [
      'an owed range and a point before the floor',
      {
        [SPOT_FIELDS.cursor]: agoMs(2),
        [SPOT_FIELDS.pending]: [
          { start: EARN_FLOOR_MS - 3 * DAY_MS, end: EARN_FLOOR_MS - 2 * DAY_MS },
          pointOf(EARN_FLOOR_MS - DAY_MS, 'lockedRewards'),
        ],
      },
    ],
  ])('sends no request that starts before the floor, with %s', async (_label, marks) => {
    const { requests } = await walkOnce({ world: worldOf(marks) });

    expect(requests.length).toBeGreaterThan(0);
    expect(minOf(requests.map((request) => request.startTime))).toBeGreaterThanOrEqual(
      EARN_FLOOR_MS,
    );
  });

  it('asks the two reward kinds first, then the four others, for every span, with the first page', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });

    const { requests } = await walkOnce({ world });

    expect(requests.slice(0, KIND_COUNT).map((request) => request.kind)).toEqual([...EARN_SERIES]);
    expect(new Set(requests.slice(0, KIND_COUNT).map((request) => request.current))).toEqual(
      new Set([1]),
    );
  });

  it('never asks a range with start equal to end', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });

    const { requests } = await walkOnce({
      world,
      answer: (query) => (query.endTime - query.startTime > 10 ? fullPage() : undefined),
    });

    expect(requests.length).toBeGreaterThan(KIND_COUNT);
    expect(requests.filter((request) => request.startTime === request.endTime)).toEqual([]);
  });
});

describe('a span too full for one page, and a page that does not add up', () => {
  const caughtUp = { [SPOT_FIELDS.cursor]: agoMs(5) };

  it('halves a span whose first kind comes back full, and reads every kind again in the half', async () => {
    const world = worldOf(caughtUp);

    const { requests } = await walkOnce({
      world,
      answer: (query) =>
        query.endTime - query.startTime > 3 * DAY_MS && query.kind === 'flexibleRewards'
          ? fullPage()
          : undefined,
    });

    const forward = requests.filter((request) => request.startTime >= agoMs(5));
    const half = agoMs(5) + Math.floor((NOW - agoMs(5)) / 2);
    expect(forward[0]).toMatchObject({
      kind: 'flexibleRewards',
      startTime: agoMs(5),
      endTime: NOW,
    });
    expect(forward[1]).toMatchObject({
      kind: 'flexibleRewards',
      startTime: agoMs(5),
      endTime: half,
    });
    expect(forward.slice(1, 1 + KIND_COUNT).map((request) => request.kind)).toEqual([
      ...EARN_SERIES,
    ]);
  });

  it('pages a span of one millisecond by current until the rows counted are the total, and writes every reward', async () => {
    const at = NOW - 1_000;
    const world = worldOf({ [SPOT_FIELDS.cursor]: at });
    const many = Array.from({ length: 120 }, (_unused, index) =>
      entryOf('lockedRewards', lockedRewardOf({ positionId: `pos-${index}`, time: at })),
    );

    const { requests, result } = await walkOnce({ world, entries: many });

    const oneMillisecond = requests.filter((request) => request.endTime - request.startTime === 1);
    expect(oneMillisecond.filter((request) => request.kind === 'lockedRewards')).toEqual([
      expect.objectContaining({ startTime: at, current: 1 }),
      expect.objectContaining({ startTime: at, current: 2 }),
    ]);
    expect(new Set(world.added.map((row) => row.externalId)).size).toBe(120);
    expect(result.imported).toBe(120);
  });

  it('E13: a total with no rows is a drift: the forward pass commits nothing of the span and the cursor stays', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      answer: (query) =>
        query.startTime >= agoMs(5) && query.kind === 'lockedSubscription'
          ? pageOf({ total: 4 })
          : undefined,
    });

    expect(stopCodes(warn)).toContain('earn-page-drift');
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(5));
  });

  it('E22: a drifted kind in the re-scan commits the other five and owes the span as a range', async () => {
    const world = worldOf(caughtUp);
    const behind = (query: { startTime: number }) => query.startTime < agoMs(5);

    await walkOnce({
      world,
      entries: [
        entryOf('lockedRedemption', lockedRedemptionOf({ redeemId: 'kept', time: agoMs(10) })),
      ],
      answer: (query) =>
        behind(query) && query.kind === 'flexibleRedemption' ? pageOf({ total: 3 }) : undefined,
    });

    expect(idsOf(world)).toEqual([
      'acc-1:earn:redeem:locked:kept:BTC:earn',
      'acc-1:earn:redeem:locked:kept:BTC',
    ]);
    expect(listOf(world)).toContainEqual({ start: agoMs(30), end: agoMs(5) });
    expect(stopCodes(warn)).toContain('earn-page-drift');
  });
});

describe('a record the walk cannot trust', () => {
  const caughtUp = { [SPOT_FIELDS.cursor]: agoMs(5) };
  const stuckAt = agoMs(10);
  const other = entryOf(
    'lockedRedemption',
    lockedRedemptionOf({ redeemId: 'fine', time: stuckAt + 3_600_000 }),
  );
  const pendingSubscription = entryOf(
    'flexibleSubscription',
    flexibleSubscriptionOf({ status: 'PENDING', purchaseId: 'stuck', time: stuckAt }),
  );

  it('E14/E19: in the re-scan, imports the reward of the span and owes the unsettled subscription at its own point, in its own kind', async () => {
    const world = worldOf(caughtUp);

    const { result } = await walkOnce({
      world,
      entries: [
        pendingSubscription,
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt })),
      ],
    });

    expect(world.added.map((row) => row.holdingId)).toEqual(['h-earn']);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleSubscription')]);
    expect(result.complete).toBe(false);
    expect(stopCodes(warn)).toEqual(['earn-not-settled']);
  });

  it('E3: owes a subscription whose split is not its amount at its point', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'lockedSubscription',
          lockedSubscriptionOf({
            amount: '0.5',
            amtFromSpot: '0.3',
            amtFromFunding: '0.1',
            time: stuckAt,
          }),
        ),
        other,
      ],
    });

    expect(listOf(world)).toEqual([pointOf(stuckAt, 'lockedSubscription')]);
    expect(stopCodes(warn)).toEqual(['earn-split-mismatch']);
  });

  it('E12: owes a record with an amount that is no number of satoshis, and one with no id, each at its point', async () => {
    const world = worldOf(caughtUp);
    const later = stuckAt + 5 * 3_600_000;

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleSubscription', flexibleSubscriptionOf({ amount: 'x', time: stuckAt })),
        entryOf('flexibleRedemption', flexibleRedemptionOf({ redeemId: '', time: later })),
      ],
    });

    expect(listOf(world)).toEqual([
      pointOf(stuckAt, 'flexibleSubscription'),
      pointOf(later, 'flexibleRedemption'),
    ]);
    expect(stopCodes(warn).sort()).toEqual(['earn-amount-invalid', 'earn-id-missing']);
  });

  it('owes a redemption to an account Kiko does not track at its point', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'flexibleRedemption',
          flexibleRedemptionOf({ destAccount: 'MARGIN', time: stuckAt }),
        ),
      ],
    });

    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleRedemption')]);
    expect(stopCodes(warn)).toEqual(['earn-account-unknown']);
  });

  it.each([
    [
      'a flexible redemption',
      entryOf('flexibleRedemption', flexibleRedemptionOf({ status: 'CREATED', time: stuckAt })),
      'flexibleRedemption',
    ],
    [
      'a locked redemption',
      entryOf('lockedRedemption', lockedRedemptionOf({ status: 'CREATED', time: stuckAt })),
      'lockedRedemption',
    ],
  ] as const)(
    '%s with status CREATED owes its point and writes nothing',
    async (_name, entry, kind) => {
      const world = worldOf(caughtUp);

      await walkOnce({ world, entries: [entry] });

      expect(world.added).toEqual([]);
      expect(listOf(world)).toEqual([pointOf(stuckAt, kind)]);
      expect(stopCodes(warn)).toEqual(['earn-not-settled']);
    },
  );

  it('a FAILED redemption writes nothing and owes nothing, of either product', async () => {
    const world = worldOf(caughtUp);

    const { result } = await walkOnce({
      world,
      entries: [
        entryOf('flexibleRedemption', flexibleRedemptionOf({ status: 'FAILED', time: stuckAt })),
        entryOf(
          'lockedRedemption',
          lockedRedemptionOf({ status: 'FAILED', isComplete: false, time: stuckAt }),
        ),
      ],
    });

    expect(world.added).toEqual([]);
    expect(pointsIn(listOf(world))).toEqual([]);
    expect(result.complete).toBe(true);
    expect(stopCodes(warn)).toEqual([]);
  });

  it('a locked redemption with isComplete false owes its point, and writes nothing', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('lockedRedemption', lockedRedemptionOf({ isComplete: false, time: stuckAt })),
      ],
    });

    expect(world.added).toEqual([]);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'lockedRedemption')]);
    expect(stopCodes(warn)).toEqual(['earn-not-settled']);
  });

  it.each([['NEW_TRANSFERRED'], ['AHEAD'], ['X'], [undefined]])(
    'a locked redemption of type %p owes its point and writes nothing: no wallet is assumed',
    async (type) => {
      const world = worldOf(caughtUp);

      await walkOnce({
        world,
        entries: [entryOf('lockedRedemption', lockedRedemptionOf({ type, time: stuckAt }))],
      });

      expect(world.added).toEqual([]);
      expect(listOf(world)).toEqual([pointOf(stuckAt, 'lockedRedemption')]);
      expect(stopCodes(warn)).toEqual(['earn-redemption-type-unconfirmed']);
    },
  );

  it.each([['CONVERT'], ['TRANSFER']])(
    'a flexible subscription of type %s owes its point and writes nothing: its money may be the locked position',
    async (type) => {
      const world = worldOf(caughtUp);

      await walkOnce({
        world,
        entries: [entryOf('flexibleSubscription', flexibleSubscriptionOf({ type, time: stuckAt }))],
      });

      expect(world.added).toEqual([]);
      expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleSubscription')]);
      expect(stopCodes(warn)).toEqual(['earn-subscription-type-unconfirmed']);
    },
  );

  it('retries the point of a locked redemption: it imports once the record reads MATURE', async () => {
    const world = worldOf(caughtUp);
    const record = (type: string) =>
      entryOf('lockedRedemption', lockedRedemptionOf({ type, redeemId: 'later', time: stuckAt }));

    await walkOnce({ world, entries: [record('NEW_TRANSFERRED')] });
    expect(world.added).toEqual([]);

    await walkOnce({ world, entries: [record('MATURE')] });

    expect(idsOf(world).sort()).toEqual([
      'acc-1:earn:redeem:locked:later:BTC',
      'acc-1:earn:redeem:locked:later:BTC:earn',
    ]);
    expect(pointsIn(listOf(world))).toEqual([]);
  });

  it('retries the point of a redemption: it imports once its status reads PAID', async () => {
    const world = worldOf(caughtUp);
    const record = (status: string) =>
      entryOf(
        'flexibleRedemption',
        flexibleRedemptionOf({ status, redeemId: 'later', time: stuckAt }),
      );

    await walkOnce({ world, entries: [record('CREATED')] });
    expect(world.added).toEqual([]);

    await walkOnce({ world, entries: [record('PAID')] });

    expect(idsOf(world)).toHaveLength(2);
    expect(pointsIn(listOf(world))).toEqual([]);
  });

  it('R30: in the re-scan, an unreadable row with a time is owed at its point in its kind, and the settled row of another kind imports', async () => {
    const world = worldOf(caughtUp);

    const { result } = await walkOnce({
      world,
      entries: [unreadableEntryOf('flexibleSubscription', stuckAt), other],
    });

    expect(idsOf(world)).toEqual([
      'acc-1:earn:redeem:locked:fine:BTC:earn',
      'acc-1:earn:redeem:locked:fine:BTC',
    ]);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleSubscription')]);
    expect(stopCodes(warn)).toEqual(['earn-row-unreadable']);
    expect(result.complete).toBe(false);
  });

  it('R30/E12: an unreadable row with no finite time owes the span, in every kind, and the other rows of the span import', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({ world, entries: [unreadableEntryOf('lockedSubscription', undefined), other] });

    expect(world.added).toHaveLength(2);
    expect(listOf(world)).toEqual([{ start: agoMs(30), end: agoMs(5) }]);
  });

  it('never rejects for a row: the run resolves, and logs the code alone', async () => {
    const world = worldOf(caughtUp);

    await expect(
      walkOnce({ world, entries: [unreadableEntryOf('flexibleSubscription', stuckAt)] }),
    ).resolves.toMatchObject({ result: { complete: false } });
    expect(warn.mock.calls).toEqual([
      [
        '[binance sync] history window stopped',
        { name: 'BinanceWalkStop', code: 'earn-row-unreadable' },
      ],
    ]);
  });

  it('logs a stop by its code alone: no amount or id reaches a log', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf(
          'flexibleSubscription',
          flexibleSubscriptionOf({
            status: 'PENDING',
            purchaseId: 'secret-purchase-id',
            amount: '1.23456789',
            time: stuckAt,
          }),
        ),
      ],
    });

    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-purchase-id|1\.2345/);
  });

  describe.each([
    ['a subscription that is not settled', pendingSubscription, 'flexibleSubscription'],
    [
      'a subscription whose split is not its amount',
      entryOf(
        'lockedSubscription',
        lockedSubscriptionOf({ amtFromSpot: '0.0005', amtFromFunding: '0', time: stuckAt }),
      ),
      'lockedSubscription',
    ],
    [
      'a redemption to an unknown account',
      entryOf('flexibleRedemption', flexibleRedemptionOf({ destAccount: 'MARGIN', time: stuckAt })),
      'flexibleRedemption',
    ],
    [
      'a subscription with an amount that is no number',
      entryOf('flexibleSubscription', flexibleSubscriptionOf({ amount: 'x', time: stuckAt })),
      'flexibleSubscription',
    ],
    [
      'a redemption with no id',
      entryOf('lockedRedemption', lockedRedemptionOf({ redeemId: '', time: stuckAt })),
      'lockedRedemption',
    ],
    [
      'a reward group of a type that is not known',
      entryOf('flexibleRewards', flexibleRewardOf({ type: 'REWARDS', time: stuckAt })),
      'flexibleRewards',
    ],
    [
      'an unreadable row with a time',
      unreadableEntryOf('lockedRedemption', stuckAt),
      'lockedRedemption',
    ],
    [
      'a redemption with status CREATED',
      entryOf(
        'flexibleRedemption',
        flexibleRedemptionOf({ status: 'CREATED', redeemId: 'created', time: stuckAt }),
      ),
      'flexibleRedemption',
    ],
    [
      'a locked redemption that is not complete',
      entryOf(
        'lockedRedemption',
        lockedRedemptionOf({ isComplete: false, redeemId: 'incomplete', time: stuckAt }),
      ),
      'lockedRedemption',
    ],
    [
      'a locked redemption of type NEW_TRANSFERRED',
      entryOf(
        'lockedRedemption',
        lockedRedemptionOf({ type: 'NEW_TRANSFERRED', redeemId: 'moved', time: stuckAt }),
      ),
      'lockedRedemption',
    ],
    [
      'a locked redemption of type AHEAD',
      entryOf(
        'lockedRedemption',
        lockedRedemptionOf({ type: 'AHEAD', redeemId: 'ahead', time: stuckAt }),
      ),
      'lockedRedemption',
    ],
    [
      'a flexible subscription of type CONVERT',
      entryOf(
        'flexibleSubscription',
        flexibleSubscriptionOf({ type: 'CONVERT', purchaseId: 'converted', time: stuckAt }),
      ),
      'flexibleSubscription',
    ],
    [
      'a flexible subscription of type TRANSFER',
      entryOf(
        'flexibleSubscription',
        flexibleSubscriptionOf({ type: 'TRANSFER', purchaseId: 'transferred', time: stuckAt }),
      ),
      'flexibleSubscription',
    ],
  ] as const)('%s in the forward window', (_name, entry, kind) => {
    const newer = entryOf(
      'flexibleRedemption',
      flexibleRedemptionOf({ redeemId: 'newer', time: agoMs(2) }),
    );
    const forwardMarks = { [SPOT_FIELDS.cursor]: agoMs(20) };

    it('is owed at its own point and the cursor goes past it: the other records of the span, the newer ones too, import in the same run', async () => {
      const world = worldOf(forwardMarks);

      const { result } = await walkOnce({ world, entries: [entry, other, newer] });

      expect(idsOf(world).sort()).toEqual([
        'acc-1:earn:redeem:flexible:newer:BTC',
        'acc-1:earn:redeem:flexible:newer:BTC:earn',
        'acc-1:earn:redeem:locked:fine:BTC',
        'acc-1:earn:redeem:locked:fine:BTC:earn',
      ]);
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(NOW);
      expect(listOf(world)).toContainEqual(pointOf(stuckAt, kind));
      expect(result.complete).toBe(false);
    });

    it('stays owed in every run after it, and a second identical run imports no row it had not', async () => {
      const world = worldOf(forwardMarks);

      await walkOnce({ world, entries: [entry, other, newer] });
      await walkOnce({ world, entries: [entry, other, newer] });

      expect(listOf(world)).toContainEqual(pointOf(stuckAt, kind));
      expect(idsOf(world)).toHaveLength(4);
    });
  });

  describe('in the forward window, a stop that owes more than a point', () => {
    const forwardMarks = { [SPOT_FIELDS.cursor]: agoMs(20) };
    const newer = entryOf(
      'flexibleRedemption',
      flexibleRedemptionOf({ redeemId: 'newer', time: agoMs(2) }),
    );

    it('E12: an unreadable row with no time leaves the span uncommitted and the cursor unmoved, and the run goes on to the re-scan', async () => {
      const world = worldOf(forwardMarks);

      const { requests } = await walkOnce({
        world,
        entries: [unreadableEntryOf('lockedRedemption', undefined), other, newer],
      });

      expect(world.added).toEqual([]);
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(20));
      expect(requests.some((request) => request.startTime === agoMs(30))).toBe(true);
    });

    it('a kind that drifted leaves the span uncommitted and the cursor unmoved, whatever the owed point beside it', async () => {
      const world = worldOf(forwardMarks);

      await walkOnce({
        world,
        entries: [pendingSubscription, other, newer],
        answer: (query) =>
          query.startTime >= agoMs(20) && query.kind === 'lockedSubscription'
            ? pageOf({ total: 4 })
            : undefined,
      });

      expect(stopCodes(warn)).toContain('earn-page-drift');
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(20));
      expect(idsOf(world)).not.toContain('acc-1:earn:redeem:flexible:newer:BTC');
    });
  });
});

describe('a point read', () => {
  it('asks its own kind only, one call, for exactly the window of the point', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [pointOf(at, 'lockedSubscription')],
    });

    const { requests } = await walkOnce({ world });

    expect(requests.filter((request) => request.startTime === at - 1)).toEqual([
      { kind: 'lockedSubscription', startTime: at - 1, endTime: at + 1, current: 1 },
    ]);
  });

  it('asks the union of the kinds of points that start together, as one window, once in each', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [
        pointOf(at, 'lockedSubscription'),
        { ...pointOf(at, 'flexibleRewards'), end: at + 1_000 },
      ],
    });

    const { requests } = await walkOnce({ world });

    const reads = requests.filter((request) => request.startTime === at - 1);
    expect(reads.map((request) => request.kind).sort()).toEqual([
      'flexibleRewards',
      'lockedSubscription',
    ]);
    expect(new Set(reads.map((request) => request.endTime))).toEqual(new Set([at + 1_000]));
  });

  it('takes the point off the list once its own record comes back settled, and writes the rows', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [pointOf(at, 'lockedSubscription')],
    });

    await walkOnce({
      world,
      entries: [
        entryOf('lockedSubscription', lockedSubscriptionOf({ purchaseId: 'late', time: at })),
      ],
    });

    expect(idsOf(world)).toEqual([
      'acc-1:earn:sub:locked:late:BTC',
      'acc-1:earn:sub:locked:late:BTC:earn',
    ]);
    expect(pointsIn(listOf(world))).toEqual([]);
  });
});

describe('the budget of a run', () => {
  const spend = (run: ReturnType<typeof freshRun>, calls: number): void => {
    for (let call = 0; call < calls; call += 1) {
      run.budget.record('earn', { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
    }
  };

  it('spends the whole cap of 30 calls on a caught-up run: the forward window, an owed range, the re-scan and the points', async () => {
    const owedRange = { start: agoMs(100), end: agoMs(99) };
    const points = Array.from({ length: 30 }, (_unused, index) =>
      pointOf(agoMs(170) + index * 5 * DAY_MS, EARN_SERIES[index % KIND_COUNT]),
    );
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [owedRange, ...points],
    });

    const { requests } = await walkOnce({ world });

    expect(CAP).toBe(30);
    expect(requests).toHaveLength(CAP);
    expect(requests.filter((request) => request.startTime === owedRange.start)).toHaveLength(
      KIND_COUNT,
    );
    expect(requests.filter((request) => request.endTime - request.startTime === 2)).toHaveLength(
      12,
    );
  });

  it('keeps the 6 calls of the re-scan and the call of a point from the owed ranges: no range takes them, however many are owed', async () => {
    const days = [100, 120, 140, 160].map((ago) => ({
      start: agoMs(ago),
      end: agoMs(ago) + DAY_MS,
    }));
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [...days, pointOf(agoMs(300), 'lockedRewards')],
    });

    const { requests } = await walkOnce({ world });

    expect(
      requests.filter((request) => request.startTime === agoMs(30)).map((request) => request.kind),
    ).toEqual([...EARN_SERIES]);
    expect(requests.filter((request) => request.startTime === agoMs(300) - 1)).toHaveLength(1);
    expect(
      days.filter((day) => requests.some((request) => request.startTime === day.start)),
    ).toHaveLength(2);
  });

  it('enters no span whose 6 calls do not fit beside the calls it keeps, and no request is made for part of it', async () => {
    const run = freshRun();
    spend(run, CAP - KIND_COUNT + 1);

    const { requests, result } = await walkOnce({ world: worldOf(), run });

    expect(requests).toEqual([]);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('enters a span whose 6 calls fit exactly', async () => {
    const run = freshRun();
    spend(run, CAP - KIND_COUNT);

    const { requests } = await walkOnce({ world: worldOf(), run });

    expect(requests).toHaveLength(KIND_COUNT);
  });

  it('asks nothing when the IP weight the minute has used leaves no room for a call of 150', async () => {
    const run = freshRun();
    run.budget.record('earn', { usedUidWeight1m: undefined, usedIpWeight1m: 5851 });

    const { requests, result } = await walkOnce({ world: worldOf(), run });

    expect(requests).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('reads a first walk in windows of 30 days, five a run, and moves the cursor to the end of the last one read', async () => {
    const world = worldOf();

    const { requests, result } = await walkOnce({ world });

    expect(requests).toHaveLength(CAP);
    expect(result.complete).toBe(false);
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(EARN_FLOOR_MS + 5 * EARN_WINDOW_MS);
    expect(requests[0].endTime - requests[0].startTime).toBe(EARN_WINDOW_MS);
  });

  it('on a 429: sets the cooldown, ends every later read, and the next run asks nothing while it lasts', async () => {
    const world = worldOf();
    let seen = 0;

    const first = await walkOnce({
      world,
      accountId: 'acc-earn-429',
      over: {
        fetchEarnRecords: jest.fn(async () => {
          seen += 1;

          if (seen === 3) {
            throw new BinanceRateLimitError(429, 60_000);
          }

          return pageOf();
        }) as never,
      },
    });

    expect(seen).toBe(3);
    expect(first.result.complete).toBe(false);
    expect(isBinanceCoolingDown('acc-earn-429', NOW + 1)).toBe(true);

    const second = await walkOnce({ world, accountId: 'acc-earn-429' });

    expect(second.requests).toEqual([]);
    expect(second.result).toEqual({ imported: 0, complete: false });
  });

  it('asks nothing while the cooldown another walk of the account set lasts, a 429 in the Transfer walk for one', async () => {
    setBinanceCooldownUntil('acc-earn-shared', NOW + 60_000);

    const { requests, result } = await walkOnce({
      world: worldOf(),
      accountId: 'acc-earn-shared',
    });

    expect(requests).toEqual([]);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('rejects for a failure that is not a rate limit, after the earlier spans committed', async () => {
    const world = worldOf();
    let seen = 0;

    await expect(
      walkOnce({
        world,
        over: {
          fetchEarnRecords: jest.fn(async () => {
            seen += 1;

            if (seen > KIND_COUNT) {
              throw new Error('boom');
            }

            return pageOf();
          }) as never,
        },
      }),
    ).rejects.toThrow('boom');
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(EARN_FLOOR_MS + EARN_WINDOW_MS);
  });

  it('charges each call to the earn lane at its own weight', () => {
    expect(COSTS.earn).toEqual({ ip: 150 });
  });
});

describe('the order of the writes', () => {
  it('writes the rows, then the list, then the re-scan mark, for a span of the re-scan', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });
    const first = agoMs(25);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleSubscription', flexibleSubscriptionOf({ status: 'PENDING', time: first })),
        entryOf('lockedRedemption', lockedRedemptionOf({ time: first + 3_600_000 })),
      ],
      answer: (query) =>
        query.endTime - query.startTime > 13 * DAY_MS && query.kind === 'flexibleRewards'
          ? fullPage()
          : undefined,
    });

    const lastForward = world.events.lastIndexOf(`cursor:${SPOT_FIELDS.cursor}`);
    expect(world.events.slice(lastForward + 1, lastForward + 4)).toEqual([
      'rows',
      'list',
      `cursor:${SPOT_FIELDS.rescan}`,
    ]);
  });

  it('writes the list with the overlap day before the cursor moves past it', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });

    await walkOnce({ world });

    expect(world.events.indexOf('list')).toBeLessThan(
      world.events.indexOf(`cursor:${SPOT_FIELDS.cursor}`),
    );
  });
});

describe('the range cursor, the point cursor and the span hints of the round-robin', () => {
  const codesLogged = () => warn.mock.calls.map((call) => (call[1] as { code?: string }).code);
  const days = [0, 1, 2].map((index) => ({
    start: agoMs(150) + index * 10 * DAY_MS,
    end: agoMs(150) + index * 10 * DAY_MS + DAY_MS,
  }));
  const base = { [SPOT_FIELDS.cursor]: agoMs(2), [SPOT_FIELDS.pending]: days };

  it('stores the end of the window of each owed day it read, under the Earn range cursor', async () => {
    const world = worldOf(base);

    const { deps } = await walkOnce({ world });

    const writes = (deps.writeWalkCursor as jest.Mock).mock.calls
      .filter((call) => call[1] === SPOT_FIELDS.range)
      .map((call) => call[2]);
    expect(writes).toEqual([days[0].end, days[1].end, days[2].end]);
  });

  it('reads the owed days that start after the stored range cursor first, then wraps around', async () => {
    const world = worldOf({ ...base, [SPOT_FIELDS.range]: days[1].end });

    const { requests } = await walkOnce({ world });

    const dayStarts = [
      ...new Set(
        requests
          .map((request) => request.startTime)
          .filter((start) => days.some((day) => day.start === start)),
      ),
    ];
    expect(dayStarts).toEqual([days[2].start, days[0].start, days[1].start]);
  });

  it('stores the point cursor of the point it read, under the Earn point cursor', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [pointOf(at, 'lockedRewards')],
    });

    await walkOnce({ world });

    expect(world.metadata[SPOT_FIELDS.point]).toBe(at - 1);
  });

  it('stores a malformed hint over with none, logging one fixed code, under the Earn span hints', async () => {
    const world = worldOf({ ...base, [SPOT_FIELDS.hints]: 'soon' });

    await walkOnce({ world });

    expect(codesLogged()).toContain('span-hints-malformed');
    expect(world.metadata[SPOT_FIELDS.hints]).toEqual({
      forward: [],
      pending: [],
      rescan: [],
      point: [],
    });
  });

  it('repairs a range cursor and a point cursor that are no numbers, logging one fixed code each', async () => {
    const world = worldOf({ ...base, [SPOT_FIELDS.range]: 'soon', [SPOT_FIELDS.point]: 'x' });

    await walkOnce({ world });

    expect(codesLogged()).toEqual(
      expect.arrayContaining(['range-cursor-malformed', 'point-cursor-malformed']),
    );
  });

  it('owes the ground before the cursor once, and logs one fixed code, for a point of a kind the walk does not read', async () => {
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(5),
      [SPOT_FIELDS.pending]: [{ start: 1, end: 2, kind: 'point', series: 'MAIN_FUNDING' }],
    });

    await walkOnce({ world });

    expect(codesLogged()).toContain('pending-malformed');
    expect(listOf(world)).not.toContainEqual(expect.objectContaining({ series: 'MAIN_FUNDING' }));
  });
});
