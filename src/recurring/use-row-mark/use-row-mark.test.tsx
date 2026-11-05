import {
  type SettingsRows,
  BANK,
  CARD,
  DOLLAR_CARD,
  RISING_CHAIN,
  STORED_AT_99,
  STORED_AT_100,
  TWO_CHAINS,
  chargeRowOf,
  createMarkLiveQueries,
  markOf,
  netflixSettingsOf,
  settingsModuleWith as mockSettingsModuleWith,
  settingsRowsOf,
  taggedQuery as mockTaggedQuery,
} from '@kiko/test-support/recurring-mark-live-queries';
import type { Currency } from '@kiko/currency/currency';
import { act, renderHook } from '@testing-library/react-native';
import type { chargeGroupsOf, seriesOfGroups } from '@kiko/recurring/detection';

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
// runs no series rule.
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
const MARKED_UNDER_ANOTHER_NAME = settingsRowsOf('spotify', {
  name: 'Spotify',
  marks: [markOf('yearly', 10_000)],
});
const MARKED_UNDER_CONSTRUCTOR = settingsRowsOf('constructor', {
  name: 'Constructor',
  marks: [markOf('yearly', 10_000)],
});

const renderRowMark = async (
  amountMinorUnits: number,
  { currency = 'UAH', description = 'Netflix', isOffered = true }: Scenario = {},
) =>
  renderHook(() =>
    useRowMark({ amountMinorUnits, description }, currency, isOffered, HOLDINGS, ACCOUNTS),
  );

const fireAgain = async (rerender: (props?: object) => Promise<void> | void): Promise<void> => {
  await act(async () => {
    await rerender();
  });
};

beforeEach(() => {
  mockLive.reset();
  mockChargeGroupsOf.mockReset();
  mockChargeGroupsOf.mockImplementation(actualDetection.chargeGroupsOf);
  mockSeriesOfGroups.mockReset();
  mockSeriesOfGroups.mockImplementation(actualDetection.seriesOfGroups);
  landLedger(RISING_CHAIN);
});

// Each row: a world that reads no ledger, and the same world changed by one thing so that it does.
const LEDGER_READ_CASES: [string, Scenario, Scenario][] = [
  ['no entry', {}, { settingsRows: STORED_AT_100 }],
  ['a hide-only entry', { settingsRows: HIDDEN_ONLY }, { settingsRows: HIDDEN_AND_MARKED }],
  [
    'an entry marked only in another currency',
    { settingsRows: STORED_AT_100_IN_DOLLARS },
    { settingsRows: STORED_AT_100_IN_DOLLARS, currency: 'USD' },
  ],
  [
    'an entry marked only under another name',
    { settingsRows: MARKED_UNDER_ANOTHER_NAME },
    { settingsRows: MARKED_UNDER_ANOTHER_NAME, description: 'Spotify' },
  ],
  [
    'a key that is a plain-object member name, with no entry under it',
    { settingsRows: STORED_AT_100, description: 'constructor' },
    { settingsRows: MARKED_UNDER_CONSTRUCTOR, description: 'constructor' },
  ],
  [
    'a row not offered',
    { settingsRows: STORED_AT_100, isOffered: false },
    { settingsRows: STORED_AT_100, isOffered: true },
  ],
];

const ledgerReadsOf = async (scenario: Scenario): Promise<number> => {
  mockLive.reset();
  landSettings(scenario.settingsRows ?? []);
  landLedger(RISING_CHAIN);
  await renderRowMark(-14_400, scenario);

  return mockLive.enabledReadsOf('recurringLedger');
};

describe('which reads useRowMark makes', () => {
  it.each(LEDGER_READ_CASES)('reads no ledger for %s', async (_title, silent) => {
    expect(await ledgerReadsOf(silent)).toBe(0);
  });

  it.each(LEDGER_READ_CASES)(
    'reads the ledger in the marked twin of %s',
    async (_title, _silent, reading) => {
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

    expect(result.current).toEqual({ chain: null, isReady: false });

    landSettings([]);
    await fireAgain(rerender);

    expect(result.current).toEqual({ chain: null, isReady: true });
  });

  it('is false right after a first pick, with the entry landed and the ledger read still empty', async () => {
    landSettings([]);

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current.isReady).toBe(true);

    landSettings(STORED_AT_100);
    mockLive.reads.recurringLedger = { rows: [], isLoading: true, error: undefined };
    await fireAgain(rerender);

    expect(mockLive.enabledReadsOf('recurringLedger')).toBeGreaterThan(0);
    expect(result.current).toEqual({ chain: null, isReady: false });

    landLedger(RISING_CHAIN);
    await fireAgain(rerender);

    expect(result.current.isReady).toBe(true);
    expect(result.current.chain).not.toBeNull();
  });

  it('is false on a rejected settings read with no chain, and a later good fire releases it', async () => {
    mockLive.reads.settings = { rows: [], isLoading: false, error: READ_FAILED };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toEqual({ chain: null, isReady: false });

    landSettings(STORED_AT_100);
    await fireAgain(rerender);

    expect(result.current.isReady).toBe(true);
    expect(result.current.chain).toEqual({ period: 'yearly', marks: [markOf('yearly', 10_000)] });
  });

  it('is false on a rejected ledger read with no chain, and a later good fire releases it', async () => {
    landSettings(STORED_AT_100);
    mockLive.reads.recurringLedger = { rows: [], isLoading: false, error: READ_FAILED };

    const { result, rerender } = await renderRowMark(-14_400);

    expect(result.current).toEqual({ chain: null, isReady: false });

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

    landSettings([]);
    await fireAgain(rerender);

    expect(mockLive.reads.recurringLedger.error).toBe(READ_FAILED);
    expect(result.current).toEqual({ chain: null, isReady: true });
  });
});

describe('the chain of a row', () => {
  it('reads the period of the chain a row of 144 sits in beside a stored 100', async () => {
    landSettings(STORED_AT_100);

    const { result } = await renderRowMark(-14_400);

    expect(result.current).toEqual({
      chain: { period: 'yearly', marks: [markOf('yearly', 10_000)] },
      isReady: true,
    });
  });

  it('reads no chain on a row of 399 beside a stored 99', async () => {
    landSettings(STORED_AT_99);
    landLedger(TWO_CHAINS);

    const { result } = await renderRowMark(-39_900);

    expect(result.current).toEqual({ chain: null, isReady: true });
  });

  it('reads the chain of the stored 99 from a row of 99, the twin of the 399 row', async () => {
    landSettings(STORED_AT_99);
    landLedger(TWO_CHAINS);

    const { result } = await renderRowMark(-9_900);

    expect(result.current.chain).toEqual({ period: 'yearly', marks: [markOf('yearly', 9_900)] });
  });

  it('reads a folded twin as its kept row', async () => {
    landSettings(STORED_AT_100);
    landLedger([...RISING_CHAIN, chargeRowOf('third-import', 0, -14_400, { source: 'import' })]);

    const { result } = await renderRowMark(-14_400);

    expect(result.current.chain).toEqual({ period: 'yearly', marks: [markOf('yearly', 10_000)] });
  });
});

describe('detection', () => {
  it('builds the charge groups once per fire and runs no series rule', async () => {
    landSettings(STORED_AT_100);

    const { rerender } = await renderRowMark(-14_400);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(1);

    await fireAgain(rerender);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(1);

    landLedger([...RISING_CHAIN]);
    await fireAgain(rerender);

    expect(mockChargeGroupsOf).toHaveBeenCalledTimes(2);
    expect(mockSeriesOfGroups).not.toHaveBeenCalled();
  });
});
