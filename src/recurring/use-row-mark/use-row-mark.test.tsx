import {
  type SettingsRows,
  BANK,
  CARD,
  DOLLAR_CARD,
  RISING_CHAIN,
  chargeRowOf,
  STORED_AT_99,
  STORED_AT_100,
  TWO_CHAINS,
  MONTHLY_AT_100,
  WITH_EXTRA_IN_MONTH,
  createMarkLiveQueries,
  markOf,
  netflixSettingsOf,
  settingsModuleWith as mockSettingsModuleWith,
  settingsRowsOf,
  taggedQuery as mockTaggedQuery,
} from '@kiko/test-support/recurring-mark-live-queries';
import type { Currency } from '@kiko/currency/currency';
import { nowOf } from '@kiko/test-support/recurring-ledger';
import { act, renderHook } from '@testing-library/react-native';
import { type chargeGroupsOf, type seriesOfGroups, groupKeyOf } from '@kiko/recurring/detection';

import { useRowMark } from './use-row-mark';

const mockLive = createMarkLiveQueries();
const { landSettings, landLedger } = mockLive;

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { __kind?: string }, tables: string[], enabled?: boolean) =>
    mockLive.answer(query, tables, enabled) ?? { data: [], isLoading: false, isFresh: true },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { recurringLedgerQuery: () => mockTaggedQuery('recurringLedger') },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { allQuery: () => mockTaggedQuery('holdings') },
}));
jest.mock('@kiko/accounts', () => ({
  accountsRepo: { listQuery: () => mockTaggedQuery('accounts') },
}));
jest.mock('@kiko/settings', () => mockSettingsModuleWith({}));

// The two parts of detection, counted: the form's hook builds the charge groups once per fire and
// runs the series rule on the group of its row alone.
const mockChargeGroupsOf = jest.fn();
const mockSeriesOfGroups = jest.fn();
jest.mock('@kiko/recurring/detection', () => {
  const actual = jest.requireActual('@kiko/recurring/detection') as {
    chargeGroupsOf: typeof chargeGroupsOf;
    seriesOfGroups: typeof seriesOfGroups;
  };

  return {
    ...actual,
    chargeGroupsOf: (...args: Parameters<typeof chargeGroupsOf>) => mockChargeGroupsOf(...args),
    seriesOfGroups: (...args: Parameters<typeof seriesOfGroups>) => mockSeriesOfGroups(...args),
  };
});

type Holdings = (typeof CARD)[];
type Accounts = (typeof BANK)[];
type Scenario = {
  settingsRows?: SettingsRows;
  currency?: Currency;
  description?: string;
  isOffered?: boolean;
  rowId?: string;
};

const actualDetection = jest.requireActual('@kiko/recurring/detection') as {
  chargeGroupsOf: typeof chargeGroupsOf;
  seriesOfGroups: typeof seriesOfGroups;
};

const READ_FAILED = new Error('read failed');
// One array each, so a render that builds none of its own keeps the hook's inputs the same.
const HOLDINGS: Holdings = [CARD, DOLLAR_CARD];
const ACCOUNTS: Accounts = [BANK];

const STORED_AT_100_IN_DOLLARS = netflixSettingsOf({ marks: [markOf('yearly', 10_000, 'USD')] });
const HIDDEN_ONLY = netflixSettingsOf({ hidden: true });
const HIDDEN_AND_MARKED = netflixSettingsOf({ hidden: true, marks: [markOf('yearly', 10_000)] });
const HIDDEN_AND_MARKED_IN_DOLLARS = netflixSettingsOf({
  hidden: true,
  marks: [markOf('yearly', 10_000, 'USD')],
});
const MARKED_UNDER_ANOTHER_NAME = settingsRowsOf('spotify', {
  name: 'Spotify',
  marks: [markOf('yearly', 10_000)],
});
const MARKED_UNDER_CONSTRUCTOR = settingsRowsOf('constructor', {
  name: 'Constructor',
  marks: [markOf('yearly', 10_000)],
});
const HIDDEN_UNDER_CONSTRUCTOR = settingsRowsOf('constructor', {
  name: 'Constructor',
  hidden: true,
});
const HIDDEN_AND_MARKED_UNDER_CONSTRUCTOR = settingsRowsOf('constructor', {
  name: 'Constructor',
  hidden: true,
  marks: [markOf('yearly', 10_000)],
});

// The ids of the ledgers' rows, by their amount.
const ROW_ID_OF_AMOUNT: Record<number, string> = {
  [-10_000]: 'first',
  [-12_000]: 'second',
  [-14_400]: 'third',
  [-9_900]: 'cheap-second',
  [-39_900]: 'dear-second',
};

const renderRowMark = async (
  amountMinorUnits: number,
  {
    currency = 'UAH',
    description = 'Netflix',
    isOffered = true,
    rowId = ROW_ID_OF_AMOUNT[amountMinorUnits],
  }: Scenario = {},
) => {
  const row = { id: rowId ?? 'stored', amountMinorUnits, description };

  return renderHook(() => useRowMark(row, currency, isOffered, HOLDINGS, ACCOUNTS));
};

const fireAgain = async (rerender: (props?: object) => Promise<void> | void): Promise<void> => {
  await act(async () => {
    await rerender();
  });
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(nowOf());
  mockLive.reset();
  mockChargeGroupsOf.mockReset();
  mockChargeGroupsOf.mockImplementation(actualDetection.chargeGroupsOf);
  mockSeriesOfGroups.mockReset();
  mockSeriesOfGroups.mockImplementation(actualDetection.seriesOfGroups);
  landLedger(RISING_CHAIN);
});

// Each row: a world that reads no ledger, and the same world changed by one thing so that it does.
// A hidden key with no mark in the row's currency shows "Not marked" whatever the ledger holds.
const SILENT_CASES: [string, Scenario, Scenario][] = [
  ['a hide-only entry', { settingsRows: HIDDEN_ONLY }, { settingsRows: HIDDEN_AND_MARKED }],
  [
    'a hidden entry marked only in another currency',
    { settingsRows: HIDDEN_AND_MARKED_IN_DOLLARS },
    { settingsRows: HIDDEN_AND_MARKED_IN_DOLLARS, currency: 'USD' },
  ],
  [
    'a hide-only entry under a plain-object member name',
    { settingsRows: HIDDEN_UNDER_CONSTRUCTOR, description: 'constructor' },
    { settingsRows: HIDDEN_AND_MARKED_UNDER_CONSTRUCTOR, description: 'constructor' },
  ],
  [
    'a row not offered',
    { settingsRows: STORED_AT_100, isOffered: false },
    { settingsRows: STORED_AT_100, isOffered: true },
  ],
];

// An offered row whose key is not hidden reads the ledger under any entry: it may sit in a
// detected series.
const READING_CASES: [string, Scenario][] = [
  ['no entry', {}],
  ['an entry marked only in another currency', { settingsRows: STORED_AT_100_IN_DOLLARS }],
  ['an entry marked only under another name', { settingsRows: MARKED_UNDER_ANOTHER_NAME }],
  [
    'a key that is a plain-object member name, with no entry under it',
    { settingsRows: STORED_AT_100, description: 'constructor' },
  ],
  [
    'a key that is a plain-object member name, with an entry under it',
    { settingsRows: MARKED_UNDER_CONSTRUCTOR, description: 'constructor' },
  ],
  ['an entry marked in this currency', { settingsRows: STORED_AT_100 }],
  ['a hidden entry marked in this currency', { settingsRows: HIDDEN_AND_MARKED }],
];

const ledgerReadsOf = async (scenario: Scenario): Promise<number> => {
  mockLive.reset();
  landSettings(scenario.settingsRows ?? []);
  landLedger(RISING_CHAIN);
  await renderRowMark(-14_400, scenario);

  return mockLive.enabledReadsOf('recurringLedger');
};

describe('which reads useRowMark makes', () => {
  it.each(SILENT_CASES)('reads no ledger for %s', async (_title, silent) => {
    expect(await ledgerReadsOf(silent)).toBe(0);
  });

  it.each(SILENT_CASES)(
    'reads the ledger in the changed twin of %s',
    async (_title, _silent, reading) => {
      expect(await ledgerReadsOf(reading)).toBeGreaterThan(0);
    },
  );

  it.each(READING_CASES)(
    'reads the ledger for an offered row under %s',
    async (_title, reading) => {
      expect(await ledgerReadsOf(reading)).toBeGreaterThan(0);
    },
  );

  it('reads the settings for a row it is offered on and for no other', async () => {
    landSettings(STORED_AT_100);
    await renderRowMark(-14_400, { isOffered: false });

    expect(mockLive.enabledReadsOf('settings')).toBe(0);

    mockLive.reset();
    landSettings(STORED_AT_100);
    await renderRowMark(-14_400, { isOffered: true });

    expect(mockLive.enabledReadsOf('settings')).toBeGreaterThan(0);
  });

  it('reads no holdings and no accounts: the screen hands them in', async () => {
    landSettings(STORED_AT_100);
    await renderRowMark(-14_400);

    expect(mockLive.enabledReadsOf('recurringLedger')).toBeGreaterThan(0);
    expect(
      mockLive.calls.filter(({ tables }) => ['holdings', 'accounts'].includes(tables[0])),
    ).toEqual([]);
  });
});

describe('isReady', () => {
  it('is false while the settings read loads, and true once it lands', async () => {
    mockLive.reads.settings = { rows: [], isLoading: true, error: undefined };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: false });

    landSettings([]);
    await fireAgain(rerender);

    expect(result.current).toEqual({ chain: null, detectedPeriod: 'monthly', isReady: true });
  });

  it('is false right after a first pick, with the entry landed and the ledger read still empty', async () => {
    landSettings([]);

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current.isReady).toBe(true);

    landSettings(STORED_AT_100);
    mockLive.reads.recurringLedger = { rows: [], isLoading: true, error: undefined };
    await fireAgain(rerender);

    expect(mockLive.enabledReadsOf('recurringLedger')).toBeGreaterThan(0);
    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: false });

    landLedger(RISING_CHAIN);
    await fireAgain(rerender);

    expect(result.current.isReady).toBe(true);
    expect(result.current.chain).not.toBeNull();
  });

  it('is false on a rejected settings read with no chain, and a later good fire releases it', async () => {
    mockLive.reads.settings = { rows: [], isLoading: false, error: READ_FAILED };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: false });

    landSettings(STORED_AT_100);
    await fireAgain(rerender);

    expect(result.current.isReady).toBe(true);
    expect(result.current.chain).toEqual({ period: 'yearly', marks: [markOf('yearly', 10_000)] });
  });

  it('is false on a rejected ledger read with no chain, and a later good fire releases it', async () => {
    landSettings(STORED_AT_100);
    mockLive.reads.recurringLedger = { rows: [], isLoading: false, error: READ_FAILED };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: false });

    landLedger(RISING_CHAIN);
    await fireAgain(rerender);

    expect(result.current.isReady).toBe(true);
    expect(result.current.chain).toEqual({ period: 'yearly', marks: [markOf('yearly', 10_000)] });
  });

  it('is true on a ledger read turned off after its rejection: the kept error does not count', async () => {
    landSettings(STORED_AT_100);
    mockLive.reads.recurringLedger = { rows: [], isLoading: false, error: READ_FAILED };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current.isReady).toBe(false);

    landSettings(HIDDEN_ONLY);
    await fireAgain(rerender);

    expect(mockLive.reads.recurringLedger.error).toBe(READ_FAILED);
    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: true });
  });
});

describe('the chain of a row', () => {
  it('reads the period of the chain a row of 144 sits in beside a stored 100', async () => {
    landSettings(STORED_AT_100);

    const { result } = await renderRowMark(-14_400);

    expect(result.current).toEqual({
      chain: { period: 'yearly', marks: [markOf('yearly', 10_000)] },
      detectedPeriod: null,
      isReady: true,
    });
  });

  it('reads no chain on a row of 399 beside a stored 99', async () => {
    landSettings(STORED_AT_99);
    landLedger(TWO_CHAINS);

    const { result } = await renderRowMark(-39_900);

    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: true });
  });

  it('reads the chain of the stored 99 from a row of 99, the twin of the 399 row', async () => {
    landSettings(STORED_AT_99);
    landLedger(TWO_CHAINS);

    const { result } = await renderRowMark(-9_900);

    expect(result.current.chain).toEqual({ period: 'yearly', marks: [markOf('yearly', 9_900)] });
  });

  it('says a chain holds the 100 of a month and not the 98 beside it', async () => {
    landSettings(MONTHLY_AT_100);
    landLedger(WITH_EXTRA_IN_MONTH);

    const extra = await renderRowMark(-9_800, { rowId: 'extra' });
    const kept = await renderRowMark(-10_000, { rowId: 'monthly-1' });
    const marks = [markOf('monthly', 10_000)];

    expect(extra.result.current.chain).toEqual({ period: 'monthly', marks, holdsRow: false });
    expect(kept.result.current.chain).toEqual({ period: 'monthly', marks, holdsRow: true });
  });
});

// Four monthly charges at 99 and four at 399 under one name, and a monthly Spotify beside them.
const BESIDE_MARKED = [
  ...[3, 2, 1, 0].map((monthsBack) => chargeRowOf(`cheap-${monthsBack}`, monthsBack, -9_900)),
  ...[3, 2, 1, 0].map((monthsBack) => chargeRowOf(`dear-${monthsBack}`, monthsBack, -39_900)),
];
const STORED_AT_99_AND_HIDDEN = netflixSettingsOf({
  hidden: true,
  marks: [markOf('yearly', 9_900)],
});
const TWO_GROUPS = [
  ...RISING_CHAIN,
  ...[2, 1, 0].map((monthsBack) =>
    chargeRowOf(`spotify-${monthsBack}`, monthsBack, -5_000, { description: 'Spotify' }),
  ),
];

describe('detectedPeriod', () => {
  it('is null until both reads have settled, then the period of the detected series of the row', async () => {
    mockLive.reads.settings = { rows: [], isLoading: true, error: undefined };
    mockLive.reads.recurringLedger = { rows: [], isLoading: true, error: undefined };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toMatchObject({ detectedPeriod: null });

    landSettings([]);
    await fireAgain(rerender);

    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: false });

    landLedger(RISING_CHAIN);
    await fireAgain(rerender);

    expect(result.current).toEqual({ chain: null, detectedPeriod: 'monthly', isReady: true });
  });

  it('is null while the ledger read is rejected, and a later good fire reads it', async () => {
    landSettings([]);
    mockLive.reads.recurringLedger = { rows: [], isLoading: false, error: READ_FAILED };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toMatchObject({ detectedPeriod: null });

    landLedger(RISING_CHAIN);
    await fireAgain(rerender);

    expect(result.current).toMatchObject({ detectedPeriod: 'monthly' });
  });

  it('is null for a row outside the series, and for the same digits in another currency', async () => {
    landSettings([]);

    const outside = await renderRowMark(-14_400, { rowId: 'not-in-the-ledger' });
    const dollars = await renderRowMark(-14_400, { currency: 'USD' });

    expect(outside.result.current).toEqual({ chain: null, detectedPeriod: null, isReady: true });
    expect(dollars.result.current).toEqual({ chain: null, detectedPeriod: null, isReady: true });
  });

  it('is null for a row in a marked chain, which keeps its chain', async () => {
    landSettings(STORED_AT_100);

    const { result } = await renderRowMark(-14_400);

    expect(result.current).toMatchObject({ detectedPeriod: null });
    expect(result.current.chain?.period).toBe('yearly');
  });

  it('is the period of Apple 399 beside a marked 99, and null on the marked chain', async () => {
    landSettings(STORED_AT_99);
    landLedger(BESIDE_MARKED);

    const dear = await renderRowMark(-39_900, { rowId: 'dear-0' });
    const cheap = await renderRowMark(-9_900, { rowId: 'cheap-0' });

    expect(dear.result.current).toEqual({ chain: null, detectedPeriod: 'monthly', isReady: true });
    expect(cheap.result.current).toMatchObject({ detectedPeriod: null });
    expect(cheap.result.current.chain?.period).toBe('yearly');
  });

  it('is null for a hidden key with no mark, without reading the ledger', async () => {
    landSettings(HIDDEN_ONLY);

    const { result } = await renderRowMark(-14_400);

    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: true });
    expect(mockLive.enabledReadsOf('recurringLedger')).toBe(0);
  });

  it('is null for a detected row of a hidden key that holds a mark elsewhere', async () => {
    landSettings(STORED_AT_99_AND_HIDDEN);
    landLedger(BESIDE_MARKED);

    const { result } = await renderRowMark(-39_900, { rowId: 'dear-0' });

    expect(mockLive.enabledReadsOf('recurringLedger')).toBeGreaterThan(0);
    expect(result.current).toEqual({ chain: null, detectedPeriod: null, isReady: true });
  });
});

describe('detection', () => {
  const newestTimesOfFirstFire = () =>
    mockChargeGroupsOf.mock.results[0]?.value.newestTimeByHoldingId;

  it('builds the charge groups once per fire, and runs the series rule on the group of its row alone', async () => {
    landLedger(TWO_GROUPS);
    landSettings([]);

    const { rerender } = await renderRowMark(-14_400);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(1);
    expect(mockChargeGroupsOf.mock.results[0]?.value.groups.size).toBe(2);
    expect(mockSeriesOfGroups).toHaveBeenCalledTimes(1);

    const [groupsAlone] = mockSeriesOfGroups.mock.calls[0] ?? [];

    expect([...groupsAlone.groups.keys()]).toEqual([groupKeyOf('netflix', 'UAH')]);
    expect(groupsAlone.newestTimeByHoldingId).toEqual(newestTimesOfFirstFire());

    await fireAgain(rerender);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(1);
    expect(mockSeriesOfGroups).toHaveBeenCalledTimes(1);

    landLedger([...TWO_GROUPS]);
    await fireAgain(rerender);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(2);
    expect(mockSeriesOfGroups).toHaveBeenCalledTimes(2);
  });

  it('runs neither again for a settings fire on an unchanged ledger', async () => {
    landLedger(TWO_GROUPS);
    landSettings([]);

    const { rerender } = await renderRowMark(-14_400);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(1);
    expect(mockSeriesOfGroups).toHaveBeenCalledTimes(1);

    for (const settingsRows of [STORED_AT_100, HIDDEN_AND_MARKED, []]) {
      landSettings(settingsRows);
      await fireAgain(rerender);
    }

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(1);
    expect(mockSeriesOfGroups).toHaveBeenCalledTimes(1);
  });
});
