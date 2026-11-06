import { DatabaseSync } from 'node:sqlite';
import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import {
  at,
  nowOf,
  monthly,
  chargeOf,
  ledgerOf,
  holdingOf,
  type Ledger,
} from '@kiko/test-support/recurring-ledger';
import { formatMoney } from '@kiko/currency/format';
import { holdCard } from '@kiko/test-support/hold-card';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { RecurringMark } from '@kiko/recurring/detection';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { type RecurringMerchantChoice, settingsRepo } from '@kiko/settings';
import { DELETE_CONFIRM_TEST_ID } from '@kiko/design-system/components/card-context-menu';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';
import { useRecurringGroups as mockUseRecurringGroups } from '@kiko/test-support/mock-recurring-groups';

import RecurringChargesScreen from './recurring-charges.screen';

type ScreenProps = ComponentProps<typeof RecurringChargesScreen>;

// The reads are the only stand-ins: the series come from the real hook, the real detection and
// the real parser of the stored entries. The writes run on a real migrated database.
let mockLedger: Ledger;

let mockSettingsRows: { recurringMerchantChoices: unknown }[];

let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);

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

jest.mock('@kiko/recurring/use-recurring-groups', () => ({
  useRecurringGroups: (shown: Parameters<typeof mockUseRecurringGroups>[0]) =>
    mockUseRecurringGroups(shown),
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
const REMOVED_PARTS = /^recurring-charges-(heading-hidden|hidden-|show-again-)/;

const NETFLIX = ledgerOf(monthly(6, 3, 419, { prefix: 'netflix' }));
const APPLE = ledgerOf([
  ...monthly(10, 5, 99, { prefix: 'cheap', description: 'Apple' }),
  ...monthly(10, 20, 399, { prefix: 'dear', description: 'Apple' }),
]);

const markAt = (amount: number): RecurringMark => ({
  currency: 'UAH',
  amountMinorUnits: amount * 100,
  period: 'monthly',
});

const storedAs = (entries: Record<string, RecurringMerchantChoice>) => [
  { recurringMerchantChoices: entries },
];

const NO_ENTRY = storedAs({});

const seedStored = (entries: Record<string, RecurringMerchantChoice>): void => {
  mockDatabase
    .prepare('UPDATE settings SET recurring_merchant_choices = ? WHERE id = 1')
    .run(JSON.stringify(entries));
};

const storedText = (): string | null =>
  (
    mockDatabase
      .prepare('SELECT recurring_merchant_choices AS stored FROM settings WHERE id = 1')
      .get() as {
      stored: string | null;
    }
  ).stored;

const storedEntries = (): unknown => JSON.parse(storedText() ?? '{}');

const storedRows = (): typeof mockSettingsRows => [{ recurringMerchantChoices: storedEntries() }];

const screenElement = () => (
  <RecurringChargesScreen
    navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
    route={asRouteProp<ScreenProps['route']>('RecurringCharges')}
  />
);

const open = async (ledger: Ledger, settingsRows: typeof mockSettingsRows) => {
  mockLedger = ledger;
  mockSettingsRows = settingsRows;

  const tree = await render(screenElement(), { wrapper: GestureRootWrapper });

  return {
    ...tree,
    // The settings read landing a write: the screen draws again from its own reads.
    store: async (next: typeof mockSettingsRows) => {
      mockSettingsRows = next;
      await tree.rerender(screenElement());
    },
    // The settings read landing what the database holds now, as the live query reads the column.
    land: async () => {
      mockSettingsRows = storedRows();
      await tree.rerender(screenElement());
    },
    // Gives the series list another ledger, as a sync landing a new charge does.
    receive: async (next: Ledger) => {
      mockLedger = next;
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

beforeEach(async () => {
  jest.spyOn(Date, 'now').mockReturnValue(nowOf());
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  await settingsRepo.ensure();
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
    expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);
  });

  describe('a hide on the detected 399 beside a mark', () => {
    const MARKED = { apple: { name: 'Apple', marks: [markAt(99)] } };
    const HIDDEN_AND_MARKED = {
      apple: { name: 'Apple', hidden: true as const, marks: [markAt(99)] },
    };

    it('leaves no detected series and the marked 99, with no line for the key', async () => {
      const screen = await open(APPLE, storedAs(MARKED));

      expect(await screen.opened()).toEqual(['Apple:9900', 'Apple:detected']);

      await screen.store(storedAs(HIDDEN_AND_MARKED));

      expect(await screen.opened()).toEqual(['Apple:9900']);
      expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);
    });
  });

  describe('a hidden merchant', () => {
    const HIDDEN = { netflix: { name: 'Netflix', hidden: true as const } };
    const HIDDEN_AND_MARKED = {
      netflix: { name: 'Netflix', hidden: true as const, marks: [markAt(419)] },
    };

    it('then marked lists the marked series, with no line for the key', async () => {
      const screen = await open(NETFLIX, storedAs(HIDDEN));

      expect(await screen.opened()).toEqual([]);
      expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);

      await screen.store(storedAs(HIDDEN_AND_MARKED));

      expect(await screen.opened()).toEqual(['Netflix:41900']);
      expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);
    });

    it('then marked and removed lists no series and no line, and the empty state', async () => {
      const screen = await open(NETFLIX, storedAs(HIDDEN_AND_MARKED));

      expect(await screen.opened()).toEqual(['Netflix:41900']);

      await screen.store(storedAs(HIDDEN));

      expect(await screen.opened()).toEqual([]);
      expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);
      expect(screen.getByTestId('recurring-charges-empty')).toBeTruthy();
    });
  });

  it('lists a mark with no charge under "Marked, No Charges", and takes it away with the mark', async () => {
    const ghost: Record<string, RecurringMerchantChoice> = {
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

describe('RecurringChargesScreen — "Not a recurring charge" by a long press, on a real database', () => {
  type Screen = Awaited<ReturnType<typeof open>>;

  const moneyText = (minorUnits: number, currency: 'UAH' | 'USD' = 'UAH'): string =>
    formatMoney(Money.of(currency, minorUnits), activeLocale());

  const MARK_419 = markAt(419);

  // The hold reaches the row mounted last, so a world puts the row it holds last in the list.
  const confirmByHold = async (screen: Screen): Promise<void> => {
    await holdCard();
    await fireEvent.press(screen.getByTestId(DELETE_CONFIRM_TEST_ID));
  };

  // What the write of a held Netflix row leaves stored, which the first test below proves.
  const openHiddenNetflix = async (): Promise<Screen> => {
    seedStored({ netflix: { name: 'Netflix', hidden: true } });

    return open(NETFLIX, storedRows());
  };

  it('takes the held detected series off the list, with no line and no way back on the list', async () => {
    const screen = await open(NETFLIX, storedRows());

    expect(await screen.opened()).toEqual(['Netflix:detected']);

    await confirmByHold(screen);
    await waitFor(() =>
      expect(storedEntries()).toEqual({ netflix: { name: 'Netflix', hidden: true } }),
    );
    await screen.land();

    expect(await screen.opened()).toEqual([]);
    expect(screen.getByTestId('recurring-charges-empty')).toBeTruthy();
    expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);
    expect(screen.queryByText('Netflix')).toBeNull();
  });

  it('keeps it off the list when a new charge of the key lands after the hide', async () => {
    const screen = await openHiddenNetflix();
    const newCharge = chargeOf('netflix-new', at(2026, 11, 3), 419, { description: 'Netflix' });

    expect(await screen.opened()).toEqual([]);

    await screen.receive(ledgerOf([...NETFLIX.rows, newCharge]));

    expect(await screen.opened()).toEqual([]);
    expect(screen.getByTestId('recurring-charges-empty')).toBeTruthy();
  });

  it('lists that new charge when the key is not hidden, which the hidden list is the twin of', async () => {
    const screen = await open(NETFLIX, storedRows());
    const newCharge = chargeOf('netflix-new', at(2026, 11, 3), 419, { description: 'Netflix' });

    await screen.receive(ledgerOf([...NETFLIX.rows, newCharge]));

    expect(await screen.opened()).toEqual(['Netflix:detected']);
  });

  it('brings it back as the marked series once a mark is written for one of its charges', async () => {
    const screen = await openHiddenNetflix();

    await settingsRepo.markRecurringCharge('netflix', 'Netflix', MARK_419);

    expect(storedEntries()).toEqual({
      netflix: { name: 'Netflix', hidden: true, marks: [MARK_419] },
    });

    await screen.land();

    expect(await screen.opened()).toEqual(['Netflix:41900']);
    expect(screen.queryByTestId('recurring-charges-empty')).toBeNull();
  });

  it('clears the marks of a held marked series with the hide, and the key detected series stays out', async () => {
    seedStored({ apple: { name: 'Apple', marks: [markAt(99)] } });

    const screen = await open(APPLE, storedRows());

    expect(await screen.opened()).toEqual(['Apple:9900', 'Apple:detected']);

    await confirmByHold(screen);
    await waitFor(() =>
      expect(storedEntries()).toEqual({ apple: { name: 'Apple', hidden: true } }),
    );
    await screen.land();

    expect(await screen.opened()).toEqual([]);
    expect(screen.getByTestId('recurring-charges-empty')).toBeTruthy();
    expect(screen.queryAllByTestId(REMOVED_PARTS)).toHaveLength(0);
  });

  it('keeps the other marks of the key listed when the held marked series is removed', async () => {
    seedStored({ apple: { name: 'Apple', marks: [markAt(99), markAt(399)] } });

    const screen = await open(APPLE, storedRows());

    expect(await screen.opened()).toEqual(['Apple:39900', 'Apple:9900']);

    await confirmByHold(screen);
    await waitFor(() => expect(storedEntries()).toMatchObject({ apple: { hidden: true } }));
    await screen.land();

    const stored = storedEntries() as { apple: { marks: RecurringMark[] } };

    expect(stored.apple.marks).toHaveLength(1);
    expect(await screen.opened()).toHaveLength(1);
  });

  it('takes every series of the key, in every currency, out of the list and the totals', async () => {
    const world = ledgerOf(
      [
        ...monthly(3, 20, 9, { prefix: 'spotify', description: 'Spotify' }),
        ...monthly(3, 5, 99, { prefix: 'apple-uah', description: 'Apple' }),
        ...monthly(3, 5, 5, { prefix: 'apple-usd', description: 'Apple', holdingId: 'dollar' }),
      ],
      { holdings: [holdingOf('dollar', 'USD')] },
    );
    const screen = await open(world, storedRows());

    expect(await screen.opened()).toEqual(['Apple:detected', 'Apple:detected', 'Spotify:detected']);
    expect(screen.getByText(moneyText(500, 'USD'))).toBeTruthy();
    expect(
      within(screen.getByTestId('recurring-charges-total')).queryByText(moneyText(900)),
    ).toBeNull();

    await confirmByHold(screen);
    await waitFor(() =>
      expect(storedEntries()).toEqual({ apple: { name: 'Apple', hidden: true } }),
    );
    await screen.land();

    expect(await screen.opened()).toEqual(['Spotify:detected']);
    expect(
      within(screen.getByTestId('recurring-charges-total')).getByText(moneyText(900)),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('recurring-charges-group-total-other')).getByText(moneyText(900)),
    ).toBeTruthy();
    expect(screen.queryByText(moneyText(9900))).toBeNull();
    expect(screen.queryByText(moneyText(500, 'USD'))).toBeNull();
    expect(screen.queryByText('Apple')).toBeNull();
  });
});
