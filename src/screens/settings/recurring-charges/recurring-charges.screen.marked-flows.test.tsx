import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { settingsRepo } from '@kiko/settings';
import { monthly, ledgerOf, nowOf, type Ledger } from '@kiko/test-support/recurring-ledger';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringChargesScreen from './recurring-charges.screen';

type ScreenProps = ComponentProps<typeof RecurringChargesScreen>;

type StoredMark = { currency: 'UAH'; amountMinorUnits: number; period: string };

type StoredEntry = { name: string; hidden?: true; marks?: StoredMark[] };

// The reads are the only stand-ins: the series come from the real hook, the real detection and
// the real parser of the stored entries.
let mockLedger: Ledger;

let mockSettingsRows: { recurringMerchantChoices: unknown }[];

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, tables: string[]) => {
    const table = tables[0] as 'transactions' | 'holdings' | 'accounts' | 'settings';
    const data = {
      transactions: mockLedger.rows,
      holdings: mockLedger.holdings,
      accounts: mockLedger.accounts,
      settings: mockSettingsRows,
    }[table];

    return { data, isLoading: false, isFresh: true };
  },
}));

jest.mock('@kiko/transactions/repo', () => {
  const actual = jest.requireActual('@kiko/transactions/repo');

  return {
    ...actual,
    transactionsRepo: { ...actual.transactionsRepo, recurringLedgerQuery: () => ({}) },
  };
});

jest.mock('@kiko/holdings/repo', () => {
  const actual = jest.requireActual('@kiko/holdings/repo');

  return { ...actual, holdingsRepo: { ...actual.holdingsRepo, allQuery: () => ({}) } };
});

jest.mock('@kiko/accounts', () => {
  const actual = jest.requireActual('@kiko/accounts');

  return { ...actual, accountsRepo: { ...actual.accountsRepo, listQuery: () => ({}) } };
});

jest.mock('@kiko/settings', () => {
  const actual = jest.requireActual('@kiko/settings');

  return {
    ...actual,
    settingsRepo: { ...actual.settingsRepo, recurringMerchantChoicesQuery: () => ({}) },
  };
});

const mockOpenInPane = jest.fn();

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => mockOpenInPane,
  useDetailPaneRoute: () => null,
  useIsScreenVisible: () => true,
}));

const ROW = /^recurring-series-row-/;
const HIDDEN_LINE = /^recurring-charges-hidden-/;

const NETFLIX = ledgerOf(monthly(6, 3, 419, { prefix: 'netflix' }));
const APPLE = ledgerOf([
  ...monthly(10, 5, 99, { prefix: 'cheap', description: 'Apple' }),
  ...monthly(10, 20, 399, { prefix: 'dear', description: 'Apple' }),
]);

const markAt = (amount: number): StoredMark => ({
  currency: 'UAH',
  amountMinorUnits: amount * 100,
  period: 'monthly',
});

const storedAs = (entries: Record<string, StoredEntry>) => [{ recurringMerchantChoices: entries }];

const NO_ENTRY = storedAs({});

const screenElement = () => (
  <RecurringChargesScreen
    navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
    route={asRouteProp<ScreenProps['route']>('RecurringCharges')}
  />
);

const open = async (ledger: Ledger, settingsRows: typeof mockSettingsRows) => {
  mockLedger = ledger;
  mockSettingsRows = settingsRows;

  const tree = await render(screenElement());

  return {
    ...tree,
    // The settings read landing a write: the screen draws again from its own reads.
    store: async (next: typeof mockSettingsRows) => {
      mockSettingsRows = next;
      await tree.rerender(screenElement());
    },
    // A tap on every listed row, read back as what each opens: a marked row carries its stored
    // amount, a detected one carries none.
    opened: async (): Promise<string[]> => {
      mockOpenInPane.mockClear();

      for (const row of tree.queryAllByTestId(ROW)) {
        await fireEvent.press(row);
      }

      return mockOpenInPane.mock.calls
        .map(([, params]) => `${params.name}:${params.markedAmountMinorUnits ?? 'detected'}`)
        .sort();
    },
  };
};

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(nowOf());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RecurringChargesScreen — the list as marks come and go', () => {
  it('drops a detected series that shares a row with a marked one, and brings it back with the mark gone', async () => {
    const screen = await open(NETFLIX, NO_ENTRY);

    expect(await screen.opened()).toEqual(['Netflix:detected']);

    await screen.store(storedAs({ netflix: { name: 'Netflix', marks: [markAt(419)] } }));

    expect(await screen.opened()).toEqual(['Netflix:41900']);

    await screen.store(NO_ENTRY);

    expect(await screen.opened()).toEqual(['Netflix:detected']);
  });

  it('lists a marked Apple 99 beside its detected 399', async () => {
    const screen = await open(APPLE, storedAs({ apple: { name: 'Apple', marks: [markAt(99)] } }));

    expect(await screen.opened()).toEqual(['Apple:9900', 'Apple:detected']);
    expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(0);
  });

  describe('a hide on the detected 399 beside a mark', () => {
    const MARKED = { apple: { name: 'Apple', marks: [markAt(99)] } };
    const HIDDEN_AND_MARKED = {
      apple: { name: 'Apple', hidden: true as const, marks: [markAt(99)] },
    };

    it('leaves one "Hidden" line, no detected series and the marked 99', async () => {
      const screen = await open(APPLE, storedAs(MARKED));

      expect(await screen.opened()).toEqual(['Apple:9900', 'Apple:detected']);

      await screen.store(storedAs(HIDDEN_AND_MARKED));

      expect(await screen.opened()).toEqual(['Apple:9900']);
      expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(1);
      expect(screen.getByTestId('recurring-charges-hidden-apple')).toHaveTextContent('Apple');
    });

    it('returns the 399 beside the marked 99 on "Show again"', async () => {
      const showSpy = jest.spyOn(settingsRepo, 'showRecurringMerchantAgain').mockResolvedValue();
      const screen = await open(APPLE, storedAs(HIDDEN_AND_MARKED));

      await fireEvent.press(screen.getByTestId('recurring-charges-show-again-apple'));

      expect(showSpy).toHaveBeenCalledWith('apple');

      await screen.store(storedAs(MARKED));

      expect(await screen.opened()).toEqual(['Apple:9900', 'Apple:detected']);
      expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(0);
    });
  });

  describe('a hidden merchant', () => {
    const HIDDEN = { netflix: { name: 'Netflix', hidden: true as const } };
    const HIDDEN_AND_MARKED = {
      netflix: { name: 'Netflix', hidden: true as const, marks: [markAt(419)] },
    };

    it('then marked lists the marked series, and the "Hidden" line stays', async () => {
      const screen = await open(NETFLIX, storedAs(HIDDEN));

      expect(await screen.opened()).toEqual([]);
      expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(1);

      await screen.store(storedAs(HIDDEN_AND_MARKED));

      expect(await screen.opened()).toEqual(['Netflix:41900']);
      expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(1);
    });

    it('then marked and removed lists the "Hidden" line and no series, until "Show again"', async () => {
      const screen = await open(NETFLIX, storedAs(HIDDEN_AND_MARKED));

      expect(await screen.opened()).toEqual(['Netflix:41900']);

      await screen.store(storedAs(HIDDEN));

      expect(await screen.opened()).toEqual([]);
      expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(1);
      expect(screen.getByTestId('recurring-charges-empty')).toBeTruthy();

      await screen.store(NO_ENTRY);

      expect(await screen.opened()).toEqual(['Netflix:detected']);
      expect(screen.queryAllByTestId(HIDDEN_LINE)).toHaveLength(0);
    });
  });

  it('lists a mark with no charge under "Marked, No Charges", and takes it away with the mark', async () => {
    const ghost = {
      ghost: { name: 'Ghost', marks: [{ ...markAt(77), period: 'yearly' }] },
    };
    const screen = await open(NETFLIX, storedAs(ghost));

    expect(screen.getByText(i18n.t('recurringCharges.markedEmptyHeading'))).toBeTruthy();
    expect(screen.getByText('Ghost')).toBeTruthy();
    expect(screen.getByText(i18n.t('recurringCharges.marked.yearly'))).toBeTruthy();
    expect(await screen.opened()).toEqual(['Netflix:detected']);

    await screen.store(NO_ENTRY);

    expect(screen.queryByText(i18n.t('recurringCharges.markedEmptyHeading'))).toBeNull();
    expect(screen.queryByText('Ghost')).toBeNull();
  });
});
