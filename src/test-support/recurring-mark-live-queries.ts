import type { AccountRow, HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import type { RecurringLedgerRow, RecurringMark, RecurringPeriod } from '@kiko/recurring/detection';

// The two reads the mark field adds to the transaction form: the settings column that holds the
// marks, and the whole-ledger read it takes only under a name marked in the row's currency. A test
// hands each query its kind through `taggedQuery` and routes the live-query mock through `answer`.

type MarkRead = { rows: unknown[]; isLoading: boolean; error: Error | undefined };
export type LiveQueryCall = { kind: string | undefined; tables: string[]; enabled: boolean };
type MarkReadKind = 'settings' | 'recurringLedger';
export type SettingsRows = { recurringMerchantChoices: unknown }[];
type Holding = Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>;
type Account = Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>;

const KINDS: readonly MarkReadKind[] = ['settings', 'recurringLedger'];

const isMarkReadKind = (kind: string | undefined): kind is MarkReadKind =>
  KINDS.some((candidate) => candidate === kind);

const settled = (): MarkRead => ({ rows: [], isLoading: false, error: undefined });

export const taggedQuery = (kind: string, details: object = {}) => ({
  ...details,
  __kind: kind,
  toSQL: () => ({ sql: kind, params: [] }),
});

/**
 * What the live-query hook gives a consumer, by its own contract: a read turned off answers `[]`
 * and not loading but keeps the `error` it last held, and a read still loading answers `[]`.
 */
export const createMarkLiveQueries = () => {
  const calls: LiveQueryCall[] = [];
  const reads: Record<MarkReadKind, MarkRead> = {
    settings: settled(),
    recurringLedger: settled(),
  };

  return {
    calls,
    reads,
    /** The answer for a mark read, or `undefined` for a query that is not one. */
    answer: (query: { __kind?: string }, tables: string[], enabled = true) => {
      calls.push({ kind: query.__kind, tables, enabled });

      if (!isMarkReadKind(query.__kind)) {
        return undefined;
      }

      const read = reads[query.__kind];

      if (!enabled) {
        return { data: [], isLoading: false, error: read.error, isFresh: true };
      }

      return {
        data: read.isLoading || read.error !== undefined ? [] : read.rows,
        isLoading: read.isLoading,
        error: read.error,
        isFresh: true,
      };
    },
    landSettings: (rows: SettingsRows) => {
      reads.settings = { rows, isLoading: false, error: undefined };
    },
    landLedger: (rows: RecurringLedgerRow[]) => {
      reads.recurringLedger = { rows, isLoading: false, error: undefined };
    },
    reset: () => {
      calls.length = 0;
      reads.settings = settled();
      reads.recurringLedger = settled();
    },
    enabledReadsOf: (kind: string): number =>
      calls.filter((call) => call.kind === kind && call.enabled).length,
  };
};

const createMarkWrites = () => {
  const markRecurringCharge = jest.fn();
  const setRecurringChainPeriod = jest.fn();
  const removeRecurringMarks = jest.fn();
  const every = [markRecurringCharge, setRecurringChainPeriod, removeRecurringMarks];

  return {
    markRecurringCharge,
    setRecurringChainPeriod,
    removeRecurringMarks,
    every,
    // Wrapped, so a hoisted module mock may name them before they exist.
    repo: {
      markRecurringCharge: (...args: unknown[]) => markRecurringCharge(...args),
      setRecurringChainPeriod: (...args: unknown[]) => setRecurringChainPeriod(...args),
      removeRecurringMarks: (...args: unknown[]) => removeRecurringMarks(...args),
    },
    reset: () => {
      for (const write of every) {
        write.mockReset();
        write.mockResolvedValue(undefined);
      }
    },
  };
};

// One per test file, made on import: the form suite loads the screen, and with it the module mock
// that names these, before any `const` of its own is set.
export const markWrites = createMarkWrites();

// The repository's own parser stays, so a stored value reads as the repository reads it.
export const settingsModuleWith = (writes: object) => {
  const actual = jest.requireActual('@kiko/settings') as { settingsRepo: object };

  return {
    ...actual,
    settingsRepo: {
      ...actual.settingsRepo,
      recurringMerchantChoicesQuery: () => taggedQuery('settings'),
      ...writes,
    },
  };
};

export const CARD: Holding = {
  id: 'card',
  accountId: 'bank',
  name: 'Card',
  currency: 'UAH',
  metadata: null,
};
export const DOLLAR_CARD: Holding = { ...CARD, id: 'dollar-card', currency: 'USD' };
export const BANK: Account = { id: 'bank', kind: 'bank', archivedAt: null };

export const markOf = (
  period: RecurringPeriod,
  amountMinorUnits: number,
  currency: Currency = 'UAH',
): RecurringMark => ({ currency, amountMinorUnits, period });

/** The settings read of a file with one merchant entry. */
export const settingsRowsOf = (key: string, entry: object): SettingsRows => [
  { recurringMerchantChoices: { [key]: entry } },
];

const NETFLIX_KEY = 'netflix';

/** The settings read of a file whose only entry is Netflix. */
export const netflixSettingsOf = (entry: object) =>
  settingsRowsOf(NETFLIX_KEY, { name: 'Netflix', ...entry });

// Stored in the period no detection finds first, so a chain's period is never a default.
export const STORED_AT_100 = netflixSettingsOf({ marks: [markOf('yearly', 10_000)] });
export const STORED_AT_99 = netflixSettingsOf({ marks: [markOf('yearly', 9_900)] });

/** A debit on the card, `monthsBack` months before October 2026. */
export const chargeRowOf = (
  id: string,
  monthsBack: number,
  amountMinorUnits: number,
  overrides: Partial<RecurringLedgerRow> = {},
): RecurringLedgerRow => ({
  id,
  holdingId: 'card',
  amountMinorUnits,
  time: new Date(2026, 9 - monthsBack, 15, 10, 30).getTime(),
  description: 'Netflix',
  mcc: null,
  counterIban: null,
  categorySetByHand: false,
  setsBalance: false,
  changeGroupId: null,
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  loanHoldingId: null,
  source: 'monobank',
  ...overrides,
});

// 100, 120 and 144 form one chain.
export const RISING_CHAIN = [
  chargeRowOf('first', 2, -10_000),
  chargeRowOf('second', 1, -12_000),
  chargeRowOf('third', 0, -14_400),
];

// A 99 and a 399, each twice: two chains under one name.
export const TWO_CHAINS = [
  chargeRowOf('cheap-first', 2, -9_900),
  chargeRowOf('cheap-second', 1, -9_900),
  chargeRowOf('dear-first', 2, -39_900),
  chargeRowOf('dear-second', 1, -39_900),
];
