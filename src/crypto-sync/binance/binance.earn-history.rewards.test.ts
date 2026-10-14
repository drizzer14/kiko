import { DAY_MS } from '@kiko/dates';

import {
  type EarnReward,
  rewardGroupRowsOf,
  rewardGroupsOf,
  settledEarnOf,
} from './binance.earn-history';
import {
  agoMs,
  entryOf,
  flexibleRewardOf,
  fullPage,
  idsOf,
  listOf,
  lockedRewardOf,
  pointOf,
  SPOT_FIELDS,
  stopCodeOf,
  stopCodes,
  unreadableEntryOf,
  walkOnce,
  worldOf,
} from './binance.earn-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { EARN_KEY, SPOT_KEY } from './binance.holding-keys';

const ACCOUNT = 'acc-1';
const TIME = agoMs(2);

const rewardOf = (over: Partial<EarnReward> = {}): EarnReward => ({
  ownerId: 'BTC001',
  type: 'REALTIME',
  time: TIME,
  amount: '0.00000012',
  ...over,
});

const keyOf = (product: string, owner: string, type: string, time: number, number: number) =>
  `${ACCOUNT}:earn:reward:${product}:${owner}:${type}:${time}:${number}`;

describe('rewardGroupsOf', () => {
  it('puts the records of one product, project, type and time in one group, in the order they came', () => {
    const first = rewardOf({ amount: '0.00000002' });
    const second = rewardOf({ amount: '0.00000001' });

    expect(rewardGroupsOf('flexible', [first, second])).toEqual([
      {
        product: 'flexible',
        ownerId: 'BTC001',
        type: 'REALTIME',
        time: TIME,
        records: [first, second],
      },
    ]);
  });

  it.each([
    ['another project', { ownerId: 'BTC002' }],
    ['another type', { type: 'BONUS' }],
    ['another time', { time: TIME + 1 }],
  ])('tells a record of %s apart: it is a group of its own', (_label, over) => {
    const groups = rewardGroupsOf('flexible', [rewardOf(), rewardOf(over)]);

    expect(groups.map((group) => group.records.length)).toEqual([1, 1]);
  });

  it('keeps the product of the group', () => {
    expect(rewardGroupsOf('locked', [rewardOf()]).map((group) => group.product)).toEqual([
      'locked',
    ]);
  });

  it('is no group for no record', () => {
    expect(rewardGroupsOf('flexible', [])).toEqual([]);
  });
});

describe('rewardGroupRowsOf', () => {
  const groupOf = (product: 'flexible' | 'locked', ...records: EarnReward[]) => {
    const [group] = rewardGroupsOf(product, records);

    return group;
  };

  it('a flexible REALTIME reward is income on the Earn wallet, "Binance Earn", with no marker, the key ending in the time and 0', () => {
    expect(rewardGroupRowsOf(ACCOUNT, groupOf('flexible', rewardOf()))).toEqual([
      {
        wallet: EARN_KEY,
        amountMinorUnits: 12,
        time: TIME,
        externalId: keyOf('flexible', 'BTC001', 'REALTIME', TIME, 0),
        description: 'Binance Earn',
      },
    ]);
  });

  it('two rewards of one group are two rows, numbered from 0 by their satoshis ascending, whatever order they came in', () => {
    const rows = rewardGroupRowsOf(
      ACCOUNT,
      groupOf('flexible', rewardOf({ amount: '0.00000002' }), rewardOf({ amount: '0.00000001' })),
    );

    expect(rows.map((row) => [row.externalId.split(':').at(-1), row.amountMinorUnits])).toEqual([
      ['0', 1],
      ['1', 2],
    ]);
  });

  it('two identical rewards are two rows, numbered 0 and 1', () => {
    const rows = rewardGroupRowsOf(ACCOUNT, groupOf('flexible', rewardOf(), rewardOf()));

    expect(rows.map((row) => row.externalId)).toEqual([
      keyOf('flexible', 'BTC001', 'REALTIME', TIME, 0),
      keyOf('flexible', 'BTC001', 'REALTIME', TIME, 1),
    ]);
  });

  it('a flexible BONUS reward is income on the Spot wallet, with no marker', () => {
    const [row] = rewardGroupRowsOf(ACCOUNT, groupOf('flexible', rewardOf({ type: 'BONUS' })));

    expect(row).toEqual({
      wallet: SPOT_KEY,
      amountMinorUnits: 12,
      time: TIME,
      externalId: keyOf('flexible', 'BTC001', 'BONUS', TIME, 0),
      description: 'Binance Earn',
    });
  });

  it('a locked reward of any type is income on the Spot wallet, keyed by its position', () => {
    const rows = ['Booster', 'REWARDS', ''].map((type) =>
      rewardGroupRowsOf(ACCOUNT, groupOf('locked', rewardOf({ ownerId: 'pos-1', type }))),
    );

    expect(rows.map(([row]) => row.wallet)).toEqual([SPOT_KEY, SPOT_KEY, SPOT_KEY]);
    expect(rows[0][0].externalId).toBe(keyOf('locked', 'pos-1', 'Booster', TIME, 0));
  });

  it.each([['REWARDS'], ['realtime'], [''], ['SOMETHING']])(
    'a flexible reward of type %p is a stop, whatever its amount: no row is guessed',
    (type) => {
      expect(
        stopCodeOf(() => rewardGroupRowsOf(ACCOUNT, groupOf('flexible', rewardOf({ type })))),
      ).toBe('earn-reward-type-unknown');
    },
  );

  it.each([['x'], [''], ['0'], ['0.000000001'], ['-0.00000001']])(
    'a reward whose amount is %p is no positive number of satoshis: the group is a stop',
    (amount) => {
      expect(
        stopCodeOf(() => rewardGroupRowsOf(ACCOUNT, groupOf('flexible', rewardOf({ amount })))),
      ).toBe('earn-amount-invalid');
    },
  );

  it('stops the WHOLE group for one member whose amount is no number: no member is numbered without it', () => {
    const group = groupOf(
      'flexible',
      rewardOf({ amount: '0.00000001' }),
      rewardOf({ amount: 'x' }),
    );

    expect(stopCodeOf(() => rewardGroupRowsOf(ACCOUNT, group))).toBe('earn-amount-invalid');
  });

  it('stops a group with no project or position id', () => {
    expect(
      stopCodeOf(() => rewardGroupRowsOf(ACCOUNT, groupOf('flexible', rewardOf({ ownerId: '' })))),
    ).toBe('earn-id-missing');
    expect(
      stopCodeOf(() => rewardGroupRowsOf(ACCOUNT, groupOf('locked', rewardOf({ ownerId: '' })))),
    ).toBe('earn-id-missing');
  });

  it('keys the rows of two accounts apart, for the same reward', () => {
    const [row] = rewardGroupRowsOf('acc-2', groupOf('flexible', rewardOf()));

    expect(row.externalId.startsWith('acc-2:earn:reward:')).toBe(true);
  });
});

describe('settledEarnOf: the reward groups of a span', () => {
  const span = { start: agoMs(10) - DAY_MS, end: agoMs(10) + DAY_MS };
  const at = agoMs(10);
  const readOf = (
    series: 'flexibleRewards',
    rows: ReturnType<typeof flexibleRewardOf>[],
    unreadable: { time: number | undefined }[] = [],
  ) => ({
    read: [
      {
        series,
        rows: rows.map((record) => ({ kind: 'flexibleRewards' as const, record })),
        unreadable,
      },
    ],
    drifted: [],
  });

  it('settles a group as ONE record: a member that cannot be trusted owes ONE point and no member of the group is a row', () => {
    const settled = settledEarnOf({
      accountId: ACCOUNT,
      span,
      read: readOf('flexibleRewards', [
        flexibleRewardOf({ time: at, rewards: '0.00000001' }),
        flexibleRewardOf({ time: at, rewards: 'x' }),
        flexibleRewardOf({ time: at + 5, rewards: '0.00000003' }),
      ]),
    });

    expect(settled.rows.map((row) => row.externalId)).toEqual([
      keyOf('flexible', 'BTC001', 'REALTIME', at + 5, 0),
    ]);
    expect(settled.owed).toEqual([pointOf(at, 'flexibleRewards')]);
    expect(settled.codes).toEqual(['earn-amount-invalid']);
  });

  it('blocks every reward group of the kind at the time of an unreadable reward row: its group cannot be known', () => {
    const settled = settledEarnOf({
      accountId: ACCOUNT,
      span,
      read: readOf(
        'flexibleRewards',
        [
          flexibleRewardOf({ time: at }),
          flexibleRewardOf({ time: at, projectId: 'BTC002' }),
          flexibleRewardOf({ time: at + 5 }),
        ],
        [{ time: at }],
      ),
    });

    expect(settled.rows.map((row) => row.time)).toEqual([at + 5]);
    expect(settled.owed).toEqual([pointOf(at, 'flexibleRewards')]);
    expect(new Set(settled.codes)).toEqual(new Set(['earn-row-unreadable']));
  });

  it('does not block the groups of the other reward kind at that time', () => {
    const settled = settledEarnOf({
      accountId: ACCOUNT,
      span,
      read: {
        read: [
          { series: 'flexibleRewards', rows: [], unreadable: [{ time: at }] },
          {
            series: 'lockedRewards',
            rows: [{ kind: 'lockedRewards', record: lockedRewardOf({ time: at }) }],
            unreadable: [],
          },
        ],
        drifted: [],
      },
    });

    expect(settled.rows.map((row) => row.wallet)).toEqual([SPOT_KEY]);
    expect(settled.owed).toEqual([pointOf(at, 'flexibleRewards')]);
  });

  it('owes the span for an unreadable reward row with no time, and blocks no group', () => {
    const settled = settledEarnOf({
      accountId: ACCOUNT,
      span,
      read: readOf('flexibleRewards', [flexibleRewardOf({ time: at })], [{ time: undefined }]),
    });

    expect(settled.rows).toHaveLength(1);
    expect(settled.owed).toEqual([span]);
  });
});

describe('the reward groups of a walk', () => {
  const caughtUp = { [SPOT_FIELDS.cursor]: agoMs(5) };
  const stuckAt = agoMs(10);
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('E7/E15/E16: writes a REALTIME reward on the Earn holding, a BONUS and a locked reward on the Spot holding, each "Binance Earn"', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time: agoMs(2) })),
        entryOf('flexibleRewards', flexibleRewardOf({ time: agoMs(3), type: 'BONUS' })),
        entryOf('lockedRewards', lockedRewardOf({ time: agoMs(4) })),
      ],
    });

    expect(world.added.map((row) => [row.holdingId, row.description, row.source])).toEqual([
      ['h-earn', 'Binance Earn', 'binance'],
      ['h-spot', 'Binance Earn', 'binance'],
      ['h-spot', 'Binance Earn', 'binance'],
    ]);
    expect(
      world.added.some((row) => 'exchangePairId' in row || 'untrackedCounterpart' in row),
    ).toBe(false);
  });

  it('writes two rewards of one group as two rows whatever order Binance lists them in', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time: agoMs(2), rewards: '0.00000002' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time: agoMs(2), rewards: '0.00000001' })),
      ],
    });

    expect(world.added.map((row) => row.amountMinorUnits)).toEqual([1, 2]);
    expect(idsOf(world)).toEqual([
      keyOf('flexible', 'BTC001', 'REALTIME', agoMs(2), 0),
      keyOf('flexible', 'BTC001', 'REALTIME', agoMs(2), 1),
    ]);
  });

  it('a reward exactly where two spans of a halved window meet is read twice and written under one key', async () => {
    const world = worldOf(caughtUp);
    const meeting = agoMs(5) + Math.floor((NOW - agoMs(5)) / 2);

    const { result } = await walkOnce({
      world,
      entries: [entryOf('flexibleRewards', flexibleRewardOf({ time: meeting }))],
      answer: (query) =>
        query.kind === 'flexibleRewards' &&
        query.startTime === agoMs(5) &&
        query.endTime - query.startTime > 3 * DAY_MS
          ? fullPage()
          : undefined,
    });

    expect(new Set(world.added.map((row) => row.externalId)).size).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('E17/E20: a reward group of a type that is not known is owed at its own point, in the kind read, and the other group of the span imports', async () => {
    const world = worldOf(caughtUp);

    const { result } = await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, type: 'REWARDS' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt + 3_600_000 })),
      ],
    });

    expect(world.added.map((row) => row.holdingId)).toEqual(['h-earn']);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleRewards')]);
    expect(stopCodes(warn)).toEqual(['earn-reward-type-unknown']);
    expect(result.complete).toBe(false);
  });

  it('owes ONE point for a group of three members that cannot be trusted, and writes none of them', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, rewards: '0.00000001' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, rewards: 'x' })),
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, rewards: '0.00000003' })),
      ],
    });

    expect(world.added).toEqual([]);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleRewards')]);
    expect(stopCodes(warn)).toEqual(['earn-amount-invalid']);
  });

  it('a reward group settled per member would shift the numbers: a group that settles later is written under 0 and 1, never 1 alone', async () => {
    const world = worldOf(caughtUp);
    const members = (second: string) => [
      entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, rewards: '0.00000001' })),
      entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, rewards: second })),
    ];

    await walkOnce({ world, entries: members('x') });
    expect(world.added).toEqual([]);

    await walkOnce({ world, entries: members('0.00000002') });

    expect(idsOf(world)).toEqual([
      keyOf('flexible', 'BTC001', 'REALTIME', stuckAt, 0),
      keyOf('flexible', 'BTC001', 'REALTIME', stuckAt, 1),
    ]);
  });

  it('an unreadable reward row at t beside a readable group at t: neither imports, ONE point is owed, the code alone is logged', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt })),
        unreadableEntryOf('flexibleRewards', stuckAt),
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt + 3_600_000 })),
      ],
    });

    expect(world.added.map((row) => row.time)).toEqual([stuckAt + 3_600_000]);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleRewards')]);
    expect(new Set(stopCodes(warn))).toEqual(new Set(['earn-row-unreadable']));
  });

  it('an unreadable reward row with no finite time owes the span, and the readable groups import', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [
        unreadableEntryOf('lockedRewards', undefined),
        entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt })),
      ],
    });

    expect(world.added).toHaveLength(1);
    expect(listOf(world)).toEqual([{ start: agoMs(30), end: agoMs(5) }]);
  });

  it('writes the owed group once its type is known, and takes its point off the list', async () => {
    const world = worldOf(caughtUp);
    const stuck = (type: string) => [
      entryOf('flexibleRewards', flexibleRewardOf({ time: stuckAt, type })),
    ];

    await walkOnce({ world, entries: stuck('REWARDS') });
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'flexibleRewards')]);

    await walkOnce({ world, entries: stuck('REALTIME') });

    expect(idsOf(world)).toEqual([keyOf('flexible', 'BTC001', 'REALTIME', stuckAt, 0)]);
    expect(listOf(world)).toEqual([]);
  });
});
