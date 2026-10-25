import maybe, { foldMap } from 'fnts/maybe';
import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { HeaderHeightContext } from '@react-navigation/elements';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import { holdingsRepo } from '@kiko/holdings/repo';
import { addMonths } from '@kiko/holdings/interest';
import { formatMoney } from '@kiko/currency/format';
import { darkTheme } from '@kiko/design-system/theme';
import { holdCard } from '@kiko/test-support/hold-card';
import {
  EDIT_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  DUPLICATE_ACTION_TEST_ID,
  VIEW_ACCOUNT_ACTION_TEST_ID,
  VIEW_HOLDING_ACTION_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import { transactionsRepo } from '@kiko/transactions/repo';
import { loanInstallments } from '@kiko/holdings/loan-schedule';
import type { LoanMeta } from '@kiko/holdings/holding-metadata';
import { DAY_MS, formatDate, startOfLocalDay } from '@kiko/dates';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import { categoryColor } from '@kiko/statistics/category-breakdown';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { type LayoutNode, layoutOf } from '@kiko/test-support/layout-of';
import { loanLedgerOutstandingMinorAt } from '@kiko/holdings/loan-ledger';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';
import { buildPriceBook, dayKeyOf, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { LargeTitleHeadingContext } from '@kiko/design-system/components/large-title-heading';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import HoldingDetailScreen from './holding-detail.screen';

type HoldingDetailProps = ComponentProps<typeof HoldingDetailScreen>;

// The Text primitive's tone -> color mapping lives inside a unistyles variant
// that the project Jest mock strips before a test can inspect it, so a money
// amount's resolved color is not observable. Mock MoneyText to expose the
// `tone` prop it is handed via a testID instead, while still rendering the
// formatted amount underneath (so the trailing ₴ that `amountForLabel` scans
// for is present). The ledger's derived rows and the interest/tax breakdown
// lines pass an explicit tone, which is exactly what these tests assert.
jest.mock('@kiko/design-system/components/money-text', () => {
  const { Text: RNText } = require('react-native');
  const { formatMoney } = require('@kiko/currency/format');

  return {
    __esModule: true,
    default: ({ money, tone }: { money: Parameters<typeof formatMoney>[0]; tone?: string }) => (
      <RNText testID={`money-tone-${tone ?? 'auto'}`}>{formatMoney(money)}</RNText>
    ),
  };
});

// The test-renderer instance type, derived from RNTL's own query rather than
// imported from react-test-renderer directly (which is not a declared dep).
type TextNode = ReturnType<Awaited<ReturnType<typeof render>>['getByText']>;

// The tightest ancestor of `label` that contains a money amount (UAH formats
// with a trailing ₴), scoped to a single ledger/breakdown row — the mocked
// MoneyText node whose `money-tone-*` testID carries the resolved tone.
const amountForLabel = (label: TextNode, currencySign = /₴/): TextNode => {
  let node = label.parent;

  for (let depth = 0; depth < 8 && node; depth += 1) {
    const matches = within(node).queryAllByText(currencySign);

    if (matches.length > 0) {
      return matches[0];
    }

    node = node.parent;
  }

  throw new Error('no amount found for label row');
};

// The ledger cards that carry `title`, so a test can read the subtitle drawn under that title
// in the same card rather than anywhere on the screen.
const cardsTitled = (cards: TextNode[], title: string): TextNode[] =>
  cards.filter((card) => within(card).queryByText(title) !== null);

// The mocked SFSymbolView forwards its resolved symbol `name` as a host prop,
// so the footer's glyphs are exactly its host nodes that carry a string `name`.
const footerGlyphNames = (footer: TextNode): string[] =>
  footer
    .queryAll((node) => typeof node.props.name === 'string')
    .map((node) => node.props.name as string);

const bondHolding = {
  id: 'h-1',
  name: 'Gov bond',
  type: 'bond',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    quantity: 10,
    faceValueMinorUnits: 100_000, // 1,000.00 each => 500.00 annual coupon
    couponPct: 5,
    couponFrequency: 'annually',
    bondKind: 'government',
    purchaseDate: Date.UTC(2024, 0, 1),
    maturityDate: Date.UTC(2027, 0, 1),
  },
};

const propertyHolding = {
  id: 'h-1',
  name: 'Flat in Kyiv',
  type: 'property_item',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    category: 'real_estate',
    lots: [{ day: Date.UTC(2024, 0, 1), quantityDelta: '1', costMinorUnits: 200_000_000 }],
  },
};

const metalHolding = {
  id: 'h-1',
  name: 'Gold bar',
  type: 'metal',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    metal: 'XAU',
    form: 'bar',
    unit: 'g',
    purity: '0.999',
    lots: [{ day: Date.UTC(2024, 0, 1), quantityDelta: '10', costMinorUnits: 5_000_000 }],
  },
};

const pricedLotHolding = {
  id: 'h-1',
  name: 'Villa',
  type: 'property_item',
  currency: 'USD',
  balanceMinorUnits: 0,
  metadata: {
    category: 'real_estate',
    lots: [{ day: Date.UTC(2024, 0, 1), quantityDelta: '3', costMinorUnits: 90_000 }],
  },
};

// A long-running structured loan, well underway by any real test-run date, so
// its schedule always has an upcoming installment to show. The start
// date is derived from `Date.now()`, not a
// fixed past year — a fixed 2020 start plus a 120-month term stops having any
// upcoming installment past 2030, which would make this fixture throw.
const startMonthsAgo = (monthsAgo: number): number => {
  const now = new Date();

  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1);
};

const annuityLoanMeta: LoanMeta = {
  kind: 'car_loan',
  principalMinorUnits: 100_000_00,
  startDate: startMonthsAgo(12),
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 120,
};

const annuityLoanHolding = {
  id: 'h-1',
  name: 'Car loan',
  type: 'loan',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: annuityLoanMeta,
};

// The same loan with so few installments left that its whole list mounts inside the FlatList's
// first render window.
const shortLoanMeta: LoanMeta = { ...annuityLoanMeta, termMonths: 15 };
const shortLoanHolding = { ...annuityLoanHolding, metadata: shortLoanMeta };

// An informal debt — its own outstanding is a manual price-point
// series, never a computed schedule (loanInstallments returns [] for it).
const noneLoanHolding = {
  id: 'h-1',
  name: 'IOU',
  type: 'loan',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    kind: 'personal',
    principalMinorUnits: 10_000_00,
    startDate: Date.UTC(2020, 0, 1),
    schedule: 'none',
  },
};

const mockClosePaneRoute = jest.fn();
// A ledger row's View actions open a page in the pane opposite this one (on one pane, a plain
// navigate); its own test pins that fallback.
const mockOpenInPane = jest.fn();
jest.mock('@kiko/navigation/pane-stack', () => ({
  useClosePaneRoute: () => mockClosePaneRoute,
  useOpenInPane: () => mockOpenInPane,
}));

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
const mockUseReminderOffer = jest.fn();
jest.mock('@kiko/reminders/offer', () => ({
  useReminderOffer: (...args: unknown[]) => mockUseReminderOffer(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
    appendDepositContribution: jest.fn(),
    removeOwnershipChange: jest.fn(),
    changeLots: jest.fn(),
    updateName: jest.fn(),
    setIcon: jest.fn(),
    setColor: jest.fn(),
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listByHoldingQuery: (holdingId: string) => ({
      toSQL: () => ({ sql: '', params: [holdingId] }),
    }),
    // A distinct `sql` marker (never a real table name) so the shared
    // `mockUseLiveQuery` below can tell this call apart from every OTHER
    // `['transactions']`-keyed call and answer it from its own seeded data
    // instead — the real query already differs (a WHERE on loan_holding_id
    // vs. holding_id), this mock just needs an equally distinguishable shape.
    listLinkedToLoanQuery: (loanHoldingId: string) => ({
      toSQL: () => ({ sql: 'linked-loan-payments', params: [loanHoldingId] }),
    }),
    // The price book's own read of every loan's linked payments — answered
    // from the SAME seeded linked rows, as on device.
    loanLedgerPaymentsQuery: () => ({
      toSQL: () => ({ sql: 'loan-ledger-payments', params: [] }),
    }),
    remove: jest.fn(),
    removePlan: jest.fn(),
  },
}));

jest.mock('@kiko/bonds/bond-register-repo', () => ({
  bondRegisterRepo: {
    findByIsinQuery: (isin: string) => ({ toSQL: () => ({ sql: '', params: [isin] }) }),
  },
}));
// The `bond_register` rows the bond yield reads for the holding's ISIN.
let mockBondRegisterRows: unknown[] = [];
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({ toSQL: () => ({ sql: '', params: [accountId] }) }),
    // A distinct `sql` marker, for the same reason as `listLinkedToLoanQuery` above: it shares
    // the `['accounts']` reactive key with `byIdQuery`.
    listQuery: () => ({ toSQL: () => ({ sql: 'accounts-list', params: [] }) }),
  },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const navigation = navigationSpy();
const route = asRouteProp<HoldingDetailProps['route']>('HoldingDetail', {
  holdingId: 'h-1',
  name: 'My deposit',
});

const cashHolding = {
  id: 'h-1',
  name: 'My deposit',
  type: 'cash',
  currency: 'UAH',
  balanceMinorUnits: 0,
};

const cardHolding = {
  id: 'h-1',
  name: 'Everyday card',
  type: 'card',
  currency: 'UAH',
  balanceMinorUnits: 0,
};

// A holding on its bank account, for the tests of a ledger row's View account action, which needs
// the account the holding sits in.
const bankAccount = { id: 'bank', name: 'Mono', kind: 'bank', archivedAt: null };
const debtsAccount = { id: 'debts', name: 'Loans', kind: 'debt', archivedAt: null };
const bankCardHolding = { ...cardHolding, accountId: 'bank' };

// A holding migration 0044 (or its restore mirror) moved a cash exchange
// leg's counterpart onto — it keeps rendering its existing leg label even
// though it cannot be picked as a new Exchange's source.
const cryptoAssetHolding = {
  id: 'h-1',
  name: 'Cold wallet',
  type: 'crypto_asset',
  currency: 'BTC',
  balanceMinorUnits: 0,
};

// A recapitalizing deposit whose earliest contribution is well in the past, so
// the breakdown carries non-zero gross/interest/tax at Date.now().
const depositHolding = {
  id: 'h-1',
  name: 'My deposit',
  type: 'term_deposit',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    contributions: [{ amountMinorUnits: 100_000, date: Date.UTC(2024, 0, 1) }],
    annualRatePct: 12,
    termMonths: 24,
    recapitalization: true,
    compounding: 'annually',
  },
};

// A deposit whose earliest contribution is dated ~now with a long term, so its
// schedule tabulates period rows that all close in the future, so every
// period row is projected.
const futureDepositHolding = {
  id: 'h-1',
  name: 'Future deposit',
  type: 'term_deposit',
  currency: 'UAH',
  balanceMinorUnits: 0,
  metadata: {
    contributions: [{ amountMinorUnits: 100_000, date: Date.now() }],
    annualRatePct: 12,
    termMonths: 24,
    recapitalization: true,
    compounding: 'annually',
  },
};

// Key each live-query result to its tag so a state-driven re-render (e.g. the
// add-contribution form) keeps returning the same data instead of draining a
// one-shot queue.
const seed = (
  holding: unknown,
  transactions: unknown[] = [],
  categories: unknown[] = [],
  // Other holdings the screen can see. The holdings live query is unfiltered on
  // device, so a row referencing ANOTHER holding (an exchange leg's counterpart)
  // can resolve its name from it.
  otherHoldings: unknown[] = [],
  // The currency rates and settings the value-header's converted-value line
  // reads. Default to no rates and a UAH base, so a base-currency holding shows
  // no second line and the existing tests stay unaffected.
  rates: unknown[] = [],
  settings: unknown[] = [{ baseCurrency: 'UAH' }],
  // The holding's owning account, so the footer's sync gate can read its
  // `institution`. Default to none, so a manual holding keeps its add action.
  account: unknown = undefined,
  // The stored price_points rows `usePriceBook()` reads — a priced holding's
  // (property_item) "Value as of" caption and its Value amount both derive
  // from these. Default to none, so an existing test that doesn't care stays
  // unaffected (a priced holding with no points falls back to cost basis).
  pricePoints: unknown[] = [],
  // Per-table isLoading overrides, for the loading-gate tests only — every
  // key defaults to `false` (an already-resolved query), so a call site that
  // omits it sees resolved queries.
  isLoading: Partial<Record<string, boolean>> = {},
  // The rows `listLinkedToLoanQuery` resolves to — the payments the loan
  // detail lists beside its scheduled ones. Defaults to none, so every existing
  // call site above keeps rendering a loan with no linked payment, unaffected.
  linkedLoanPayments: unknown[] = [],
  // Every account — what a loan's linked payments resolve their PAYER's account from. Read only
  // for a loan.
  accountList: unknown[] = [],
): void => {
  // A per-table result map, keyed the same way the old if-chain branched — a
  // lookup instead of a chain keeps this well under the cognitive-complexity
  // budget (kiko-code-style). SQLite returns NULL, never undefined, for a
  // column a row does not set, so the transactions default normalizes every
  // nullable marker the screen reads the same way, and gives a row the holding
  // it belongs to — an `undefined` here would be a fixture artefact the device
  // never produces.
  const resultByTable: Record<string, { data: unknown[]; isLoading: boolean; isFresh?: boolean }> =
    {
      holdings: {
        data: [holding, ...otherHoldings],
        isLoading: isLoading.holdings ?? false,
        isFresh: !(isLoading.holdings ?? false),
      },
      categories: { data: categories, isLoading: isLoading.categories ?? false },
      currency_rates: { data: rates, isLoading: isLoading.currency_rates ?? false },
      settings: { data: settings, isLoading: isLoading.settings ?? false },
      accounts: {
        data: foldMap(maybe(account), (found) => [found]) ?? [],
        isLoading: isLoading.accounts ?? false,
      },
      price_points: { data: pricePoints, isLoading: isLoading.price_points ?? false },
      bond_register: { data: mockBondRegisterRows, isLoading: isLoading.bond_register ?? false },
      transactions: {
        data: transactions.map((row) => ({
          exchangeCounterpartHoldingId: null,
          holdingId: 'h-1',
          ...(row as Record<string, unknown>),
        })),
        isLoading: isLoading.transactions ?? false,
      },
    };
  const linkedLoanPaymentsResult = {
    data: linkedLoanPayments.map((row) => ({
      exchangeCounterpartHoldingId: null,
      ...(row as Record<string, unknown>),
    })),
    isLoading: isLoading.linkedLoanPayments ?? false,
  };
  // The price book's read names each payment by its transaction id, as the real query selects it.
  const loanLedgerPaymentsResult = {
    ...linkedLoanPaymentsResult,
    data: linkedLoanPaymentsResult.data.map((row) => ({
      ...row,
      transactionId: (row as { id?: string }).id,
    })),
  };

  // `listLinkedToLoanQuery` shares the `['transactions']` reactive key with
  // `listByHoldingQuery` (both really do listen on the same table), so a
  // lookup keyed on `keys[0]` alone cannot tell the two calls apart — this
  // reads the query's own `toSQL().sql` marker instead (mocked above) to
  // route it to its own seeded data.
  mockUseLiveQuery.mockImplementation((query: unknown, keys: string[], enabled = true) => {
    // Mirrors the real hook's own disabled contract (`use-live-query.ts`):
    // `false` reads as `[]`/not-loading, never the seeded data — the
    // Linked-payments query is disabled outright for a non-loan holding.
    if (!enabled) {
      return { data: [], isLoading: false };
    }

    const sql = (query as { toSQL: () => { sql: string } }).toSQL().sql;

    if (sql === 'loan-ledger-payments') {
      return loanLedgerPaymentsResult;
    }

    if (sql === 'accounts-list') {
      return { data: accountList, isLoading: isLoading.accountList ?? false };
    }

    return sql === 'linked-loan-payments'
      ? linkedLoanPaymentsResult
      : (resultByTable[keys[0]] ?? resultByTable.transactions);
  });
};

const screenElement = () => (
  <HoldingDetailScreen
    navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
    route={route}
  />
);

const renderScreen = () => render(screenElement(), { wrapper: GestureRootWrapper });

describe('HoldingDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(transactionsRepo.removePlan).mockResolvedValue({ split: false });
  });

  // The user placed the manual-entry offer on the account page only.
  it('never shows the reminder offer, even when the account has one', async () => {
    mockUseReminderOffer.mockReturnValue({
      kind: 'add_transactions',
      accept: jest.fn(),
      dismiss: jest.fn(),
    });
    seed(cashHolding);

    const { queryByText } = await renderScreen();

    expect(mockUseReminderOffer).not.toHaveBeenCalled();
    expect(queryByText(i18n.t('reminders.offer.addTransactionsMessage'))).toBeNull();
  });

  it('sets the header title to the holding name', async () => {
    seed(cashHolding);

    await renderScreen();

    // The name is the plain string `title` — the native large title the back
    // button on any pushed screen reads.
    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My deposit' }),
    );
  });

  it('renders a virtualized ledger list and drives the nav title from the name, with no custom header title', async () => {
    seed(cashHolding);

    const { getByTestId } = await renderScreen();

    // The transaction ledger is a virtualized FlatList that owns the screen's
    // scrolling (so a synced card's thousands of rows never all mount at once) —
    // the screen is not a plain scroll view.
    expect(getByTestId('ledger-list')).toBeTruthy();
    // The name is the plain string `title` — the native large title — with NO
    // `headerTitle` render function and NO `headerLargeTitle` toggle (the icon
    // moved beside the Value amount in the body).
    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My deposit' }),
    );

    for (const [options] of (navigation.setOptions as jest.Mock).mock.calls) {
      expect(options.headerTitle).toBeUndefined();
      expect(options.headerLargeTitle).toBeUndefined();
    }
  });

  it('adjusts the ledger list content inset automatically so the native large title does not overlap it at scroll-top', async () => {
    seed(cashHolding);

    const { getByTestId } = await renderScreen();

    // This screen sits under `AccountsStack`'s `headerLargeTitle: true`, and the
    // FlatList — not `Screen`'s ScrollView — owns the scrolling. Without this
    // prop the native large title has no scroll view to attach its content
    // inset to and overlaps the list header at scroll-top. `Screen
    // bleedBottom`/`bleedTop` drop the double top inset; this
    // matches the working `account-detail` scroll ScrollView's own setting.
    expect(getByTestId('ledger-list').props.contentInsetAdjustmentBehavior).toBe('automatic');
  });

  it('renders the ledger list with no intermediate Screen content wrapper, so the native large title can collapse', async () => {
    seed(cashHolding);

    const { getByTestId, queryByTestId } = await renderScreen();

    // iOS collapses the native large title only when the scroll view it tracks
    // is reachable as a DIRECT child of the SafeAreaView, walking the first-child
    // chain — an intermediate padded wrapper `View` between them stops the
    // collapse (the title stays stuck expanded). So `Screen bleedTop` renders
    // this FlatList directly, with NO `screen-content`
    // wrapper (the wrapper the plain/`bleedBottom` branches still use). Its
    // absence is the structural contract that keeps the large title collapsing.
    expect(getByTestId('ledger-list')).toBeTruthy();
    expect(queryByTestId('screen-content')).toBeNull();
  });

  it('gives the ledger list its own horizontal and top content padding, since it owns the screen edges directly', async () => {
    seed(cashHolding);

    const { getByTestId } = await renderScreen();

    // With no Screen `content` wrapper around it, the FlatList owns the screen's
    // side gutter and top gap itself, in its own content container. Both are
    // the base `spacing(4)` = 16 step, so the rows sit inset from the edges.
    const listContentStyle = StyleSheet.flatten(
      getByTestId('ledger-list').props.contentContainerStyle,
    );
    expect(listContentStyle.paddingHorizontal).toBe(16);
    expect(listContentStyle.paddingTop).toBe(16);
  });

  it('caps and centres the ledger content in a pane, and leaves the list the whole pane', async () => {
    seed(cashHolding);

    const { getByTestId } = await render(
      <PaneContext.Provider value={paneContextOf('rows', 'primary')}>
        <HoldingDetailScreen
          navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
          route={route}
        />
      </PaneContext.Provider>,
      { wrapper: GestureRootWrapper },
    );
    const list = getByTestId('ledger-list');
    const content = StyleSheet.flatten(list.props.contentContainerStyle);

    expect(content.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
    expect(content.alignSelf).toBe('center');
    expect(content.paddingHorizontal).toBe(16);
    expect(StyleSheet.flatten(list.props.style)?.maxWidth).toBeUndefined();
  });

  it.each([
    ['companion', false],
    ['primary', undefined],
  ] as const)(
    'stops UIKit insetting the ledger scroll indicator only in the left %s pane of columns (%s)',
    async (pane, expected) => {
      seed(cashHolding);

      const { getByTestId } = await render(
        <PaneContext.Provider value={paneContextOf('columns', pane)}>
          <HoldingDetailScreen
            navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
            route={route}
          />
        </PaneContext.Provider>,
        { wrapper: GestureRootWrapper },
      );

      expect(getByTestId('ledger-list').props.automaticallyAdjustsScrollIndicatorInsets).toBe(
        expected,
      );
    },
  );

  describe('when its holding is deleted from the other pane', () => {
    // The hook's own cases live in its test; these pin that the screen wires the hook, and what it
    // gives the hook as fresh.
    // The page is open for h-1, and the holdings read has no such row.
    const seedGone = (isLoading: Partial<Record<string, boolean>> = {}) =>
      seed({ ...cashHolding, id: 'h-2' }, [], [], [], [], undefined, undefined, [], isLoading);

    const renderInPane = () =>
      render(
        <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
          <HoldingDetailScreen
            navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
            route={route}
          />
        </PaneContext.Provider>,
        { wrapper: GestureRootWrapper },
      );

    it('closes its own route in a pane', async () => {
      seedGone();

      await renderInPane();

      expect(mockClosePaneRoute).toHaveBeenCalledWith('HoldingDetail-test');
    });

    it('stays open while its holdings are still loading', async () => {
      seedGone({ holdings: true });

      await renderInPane();

      expect(mockClosePaneRoute).not.toHaveBeenCalled();
    });
  });

  it('renders a view-only header with no inline name, icon, or color editors', async () => {
    seed(cardHolding);

    const { queryByLabelText } = await renderScreen();

    // Identity editing lives in the dedicated edit form: the header offers no
    // icon-picker toggle, editable name field, or color row.
    expect(queryByLabelText('Change Icon')).toBeNull();
    expect(queryByLabelText('Everyday card name')).toBeNull();
    expect(queryByLabelText('Color violet')).toBeNull();
  });

  it('offers an Edit action in the header that opens the holding edit form', async () => {
    seed({ ...cardHolding, accountId: 'acc-1' }, [], [], [], [], [{ baseCurrency: 'UAH' }], {
      id: 'acc-1',
      kind: 'bank',
      institution: null,
    });

    await renderScreen();

    // Pressing it passes the owning account so the form can constrain the type
    // chips.
    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.unstable_headerRightItems,
    );
    expect(call).toBeDefined();
    const items = call[0].unstable_headerRightItems({ canGoBack: true });
    expect(items.some((item: { type: string }) => item.type === 'custom')).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'button',
      label: 'Edit',
      accessibilityLabel: 'Edit',
      icon: { type: 'sfSymbol', name: 'pencil' },
    });
    items[0].onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
      accountId: 'acc-1',
      holdingId: 'h-1',
      debtAccount: false,
    });
  });

  describe('the header of a Property or Loan holding', () => {
    const headerItems = (): {
      type: string;
      label: string;
      accessibilityLabel: string;
      icon: unknown;
      sharesBackground: boolean;
      onPress: () => void;
    }[] => {
      const call = (navigation.setOptions as jest.Mock).mock.calls.find(
        ([options]) => options.unstable_headerRightItems,
      );

      return call[0].unstable_headerRightItems({ canGoBack: true });
    };

    it.each([
      ['property', 'Properties'],
      ['debt', 'Loans'],
    ] as const)(
      'offers the pencil only for a %s holding, with no account button',
      async (kind, accountName) => {
        seed({ ...cardHolding, accountId: 'acc-1' }, [], [], [], [], [{ baseCurrency: 'UAH' }], {
          id: 'acc-1',
          kind,
          name: accountName,
          archivedAt: null,
          institution: null,
        });

        await renderScreen();

        const items = headerItems();

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ label: 'Edit', icon: { name: 'pencil' } });
        expect(JSON.stringify(items)).not.toContain('Account:');
        items[0].onPress();
        expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
          accountId: 'acc-1',
          holdingId: 'h-1',
          debtAccount: kind === 'debt',
        });
        expect(navigation.navigate).not.toHaveBeenCalledWith('AccountForm', expect.anything());
      },
    );
  });

  it('renders a stored holding of a removed type with a generic glyph and no Edit action', async () => {
    seed({ ...cardHolding, type: 'share', accountId: 'acc-1' }, [], [], [], [], [], {
      id: 'acc-1',
      kind: 'bank',
      institution: null,
    });

    const { getByLabelText } = await renderScreen();

    // The edit form has no descriptor for the type and would crash on it.
    expect(getByLabelText('Icon list.bullet.rectangle')).toBeTruthy();
    expect(
      (navigation.setOptions as jest.Mock).mock.calls.some(
        ([options]) => options.unstable_headerRightItems,
      ),
    ).toBe(false);
  });

  it("tells the edit form that a debt account's holding is a loan", async () => {
    seed({ ...annuityLoanHolding, accountId: 'acc-1' }, [], [], [], [], [{ baseCurrency: 'UAH' }], {
      id: 'acc-1',
      kind: 'debt',
      institution: null,
    });

    await renderScreen();

    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.unstable_headerRightItems,
    );
    call[0].unstable_headerRightItems({ canGoBack: true })[0].onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
      accountId: 'acc-1',
      holdingId: 'h-1',
      debtAccount: true,
    });
  });

  it('leaves the loan question to the edit form while the account row still loads', async () => {
    seed(
      { ...annuityLoanHolding, accountId: 'acc-1' },
      [],
      [],
      [],
      [],
      [{ baseCurrency: 'UAH' }],
      undefined,
      [],
      { accounts: true },
    );

    await renderScreen();

    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.unstable_headerRightItems,
    );
    call[0].unstable_headerRightItems({ canGoBack: true })[0].onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
      accountId: 'acc-1',
      holdingId: 'h-1',
      debtAccount: undefined,
    });
  });

  it('tints the holding identity icon beside the Value amount with the holding stored color', async () => {
    seed({ ...cardHolding, color: darkTheme.colors.entityColors.violet });

    const { getByLabelText } = await renderScreen();

    // The holding icon now sits beside the Value amount (the nav title shows the
    // NAME only): a card shows the creditcard glyph, tinted its stored violet.
    expect(getByLabelText('Icon creditcard').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it("shows a property's category glyph as its identity icon when it has no icon of its own", async () => {
    seed({ ...propertyHolding, metadata: { ...propertyHolding.metadata, category: 'valuable' } });

    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Icon diamond.fill')).toBeTruthy();
  });

  it('tints the holding identity icon beside the Value amount with the type default color when no color is stored', async () => {
    seed(cardHolding);

    const { getByLabelText } = await renderScreen();

    // A `card` holding with no color reads the card type default (white).
    expect(getByLabelText('Icon creditcard').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('resolves the identity icon color the same way the card does — an empty-string stored color falls back to the type default', async () => {
    // A stored color of '' (neither null nor undefined) slips past a bare
    // `color ?? default`, leaving the header tinted with an invalid empty color
    // while the card (via resolveEntityColor) shows the type default. The header
    // must resolve through the same helper so the identity color never diverges.
    seed({ ...cardHolding, color: '' });

    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Icon creditcard').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('shows gross, interest, and tax detail for a taxable deposit', async () => {
    seed(depositHolding);

    const { getByText } = await renderScreen();

    expect(getByText('Value')).toBeTruthy();
    expect(getByText('Gross value')).toBeTruthy();
    expect(getByText('Interest earned')).toBeTruthy();
    expect(getByText('Tax withheld')).toBeTruthy();
  });

  it('marks future lifecycle entries as Projected in a subtitle under their title', async () => {
    seed(futureDepositHolding);

    const { getAllByTestId, queryByText } = await renderScreen();
    const accruals = cardsTitled(getAllByTestId('ledger-row'), 'Interest accrual');

    // The separate schedule card is gone; the lifecycle renders inline. A brand-
    // new deposit's future accruals render dimmed with "Projected" under the title.
    // futureDepositHolding is a term_deposit (day-granular), so no caption
    // sits under the amount.
    expect(accruals.length).toBeGreaterThan(0);

    for (const accrual of accruals) {
      expect(within(accrual).getByText('Projected')).toBeTruthy();
    }

    expect(queryByText('Interest accrual · Projected')).toBeNull();
  });

  it('renders the deposit lifecycle inline in the transactions list', async () => {
    seed(depositHolding);

    const { getByText, getAllByText } = await renderScreen();

    // The lifecycle is inline ledger entries (no separate schedule card): the
    // opening deposit, per-period interest accruals, and capitalizations.
    expect(getByText('Opening deposit')).toBeTruthy();
    expect(getAllByText('Interest accrual').length).toBeGreaterThan(0);
    expect(getAllByText('Capitalization').length).toBeGreaterThan(0);
  });

  it('shows the shared default description for a transaction with an empty description', async () => {
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: 1, description: '', source: 'manual' },
      { id: 'x2', amountMinorUnits: 5000, time: 2, description: '', source: 'manual' },
    ]);

    const { getByText } = await renderScreen();

    expect(getByText('Everyday card expense')).toBeTruthy();
    expect(getByText('Everyday card income')).toBeTruthy();
  });

  it('renders each ledger row as a glass card (per the HIG audit)', async () => {
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { getAllByTestId } = await renderScreen();

    // Each ledger row is wrapped in the shared solid content-layer `Card`,
    // matching the app's card language, rather than a plain surface-filled box.
    expect(getAllByTestId('ledger-row').length).toBeGreaterThan(0);
  });

  it('stamps a time-specific holding row with the bare HH:MM time', async () => {
    // A card is time-specific: its row shows the bare "HH:MM" — the day
    // header (not the row) now owns the date.
    const at = new Date(2024, 0, 15, 9, 5).getTime();
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: at, description: 'Coffee', source: 'manual' },
    ]);

    const { getByText } = await renderScreen();

    expect(getByText('09:05')).toBeTruthy();
  });

  it('shows a loan-link marker on a row carrying a loan link', async () => {
    seed(cardHolding, [
      {
        id: 'x1',
        amountMinorUnits: -5000,
        time: 1,
        description: 'Loan payment',
        source: 'manual',
        loanHoldingId: 'loan-1',
      },
    ]);

    const { getAllByTestId } = await renderScreen();
    const ledgerRow = getAllByTestId('ledger-row')[0];

    expect(within(ledgerRow).queryByTestId('ledger-row-loan-link-marker')).toBeTruthy();
  });

  it('shows no loan-link marker on an unlinked row', async () => {
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { getAllByTestId } = await renderScreen();
    const ledgerRow = getAllByTestId('ledger-row')[0];

    expect(within(ledgerRow).queryByTestId('ledger-row-loan-link-marker')).toBeNull();
  });

  it('right-aligns the stored transaction row timestamp so it sits below the value, like Home', async () => {
    const at = new Date(2024, 0, 15, 9, 5).getTime();
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: at, description: 'Coffee', source: 'manual' },
    ]);

    const { getByText } = await renderScreen();

    // The timestamp caption sits in the right-aligned amount column, directly
    // under the value, rather than hanging below the whole row.
    const column = ancestorWithStyle(getByText('09:05'), 'flexShrink');
    expect(StyleSheet.flatten(column.props.style)).toMatchObject({ alignItems: 'flex-end' });
    expect(within(column).getByTestId('money-tone-auto')).toBeTruthy();
  });

  it('right-aligns the derived lot row time caption so it sits below the value', async () => {
    seed(metalHolding);

    const { getByTestId } = await renderScreen();

    // A lot row on a timed type keeps only its time as the caption, in the same
    // amount column as the value.
    const row = getByTestId('ledger-row');
    const column = ancestorWithStyle(within(row).getByText(/^\d{2}:\d{2}$/), 'flexShrink');
    expect(StyleSheet.flatten(column.props.style)).toMatchObject({ alignItems: 'flex-end' });
    expect(within(row).queryByText(/Computed|Projected/)).toBeNull();
  });

  it('gives a derived row of a day-granular type no amount caption', async () => {
    seed(depositHolding);

    const { getAllByTestId } = await renderScreen();

    for (const row of getAllByTestId('ledger-row')) {
      expect(within(row).queryByText(/^\d{2}:\d{2}$/)).toBeNull();
    }
  });

  it('draws the loan-link marker beside the time in the amount column, not in the lead', async () => {
    seed(cardHolding, [
      {
        id: 'x1',
        amountMinorUnits: -5000,
        time: new Date(2024, 0, 15, 9, 5).getTime(),
        description: 'Loan payment',
        source: 'manual',
        loanHoldingId: 'loan-1',
      },
    ]);

    const { getByText } = await renderScreen();
    const column = ancestorWithStyle(getByText('09:05'), 'flexShrink');

    expect(within(column).getByTestId('ledger-row-loan-link-marker')).toBeTruthy();
  });

  it.each([
    ['a term_deposit', depositHolding],
    ['a bond', bondHolding],
  ])('renders no HH:MM on %s row, leaving the date to the day header', async (_label, holding) => {
    // A deposit/bond event is day-granular, so the row renders no footer at
    // all: the shared day-section header is the ONLY place the date appears.
    const at = new Date(2024, 5, 20, 9, 5).getTime();
    seed(holding, [
      { id: 'x1', amountMinorUnits: -5000, time: at, description: 'Top-up', source: 'manual' },
    ]);

    const { getByText, queryByText } = await renderScreen();

    // getByText throws on more than one match, so this also proves the date is
    // emitted exactly once — by the day header, not repeated in the row footer.
    expect(getByText('20.06.2024')).toBeTruthy();
    expect(queryByText('20.06.2024 09:05')).toBeNull();
  });

  it('labels an unlabelled exchange leg from its counterpart holding, not as an expense', async () => {
    // The leg persists no description — only the counterpart's holding id — so
    // the row must read as an exchange rather than falling back to this
    // holding's own income/expense default.
    seed(
      cardHolding,
      [
        {
          id: 'x3',
          amountMinorUnits: -5000,
          time: 1,
          description: '',
          exchangeCounterpartHoldingId: 'h-2',
          source: 'manual',
        },
      ],
      [],
      [{ id: 'h-2', name: 'Savings', type: 'cash', currency: 'USD', balanceMinorUnits: 0 }],
    );

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Exchange to Savings')).toBeTruthy();
    expect(queryByText('Everyday card expense')).toBeNull();
  });

  it('labels a leg to a holding of the same currency as a transfer, not an exchange', async () => {
    // Nothing is converted between two holdings of one currency, so the screen
    // must hand the row label both holdings' currencies for it to say "Transfer".
    seed(
      cardHolding,
      [
        {
          id: 'x3',
          holdingId: 'h-1',
          amountMinorUnits: -5000,
          time: 2,
          description: '',
          exchangeCounterpartHoldingId: 'h-2',
          source: 'manual',
        },
        {
          id: 'x4',
          holdingId: 'h-1',
          amountMinorUnits: 5000,
          time: 1,
          description: '',
          exchangeCounterpartHoldingId: 'h-2',
          source: 'manual',
        },
      ],
      [],
      [{ id: 'h-2', name: 'Savings', type: 'cash', currency: 'UAH', balanceMinorUnits: 0 }],
    );

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Transfer to Savings')).toBeTruthy();
    expect(getByText('Transfer from Savings')).toBeTruthy();
    expect(queryByText('Exchange to Savings')).toBeNull();
  });

  it('renders an existing exchange leg label on a crypto_asset holding, unchanged by the type', async () => {
    // A crypto_asset holding (e.g. one migration 0044 moved a cash holding
    // onto) keeps its OWN existing exchange leg — the label rendering reads
    // the row's own marker, never the holding's current type.
    seed(
      cryptoAssetHolding,
      [
        {
          id: 'x3',
          amountMinorUnits: -5000,
          time: 1,
          description: '',
          exchangeCounterpartHoldingId: 'h-2',
          source: 'manual',
        },
      ],
      [],
      [{ id: 'h-2', name: 'Savings', type: 'cash', currency: 'USD', balanceMinorUnits: 0 }],
    );

    const { getByText } = await renderScreen();

    expect(getByText('Exchange to Savings')).toBeTruthy();
  });

  it('pins the Add transaction action to the screen footer', async () => {
    seed(cardHolding);

    const { getByTestId } = await renderScreen();

    // The action sits in the Screen footer slot so it stays pinned to the bottom
    // on a short page rather than floating beneath the (possibly empty) ledger.
    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add transaction')).toBeTruthy();
  });

  it('leads the Add transaction action with the generic transaction glyph', async () => {
    seed(cardHolding);

    const { getByTestId } = await renderScreen();

    expect(footerGlyphNames(getByTestId('screen-footer'))).toEqual(['arrow.up.arrow.down']);
  });

  it('shows the main-currency converted value under the amount for a foreign-currency holding', async () => {
    // A USD holding against a UAH base, with a USD:UAH rate cached, shows a
    // smaller converted base-currency line beneath its own-currency Value — the
    // same converted caption the holding card already renders.
    seed(
      { ...cardHolding, currency: 'USD', balanceMinorUnits: 10_000 },
      [],
      [],
      [],
      [{ base: 'USD', quote: 'UAH', rate: '41' }],
      [{ baseCurrency: 'UAH' }],
    );

    const { getByTestId } = await renderScreen();

    // 100.00 USD * 41 = 4,100.00 UAH — a UAH (₴) amount rendered as the caption.
    const converted = getByTestId('holding-detail-converted');
    expect(within(converted).getByText(/₴/)).toBeTruthy();
    // The caption sits INSIDE the shared value header (`holding-value-header`),
    // tucked directly under the amount — not as a detached line at the bottom of
    // the summary block. Scoping the query to the
    // header node is what proves the grouping.
    expect(
      within(getByTestId('holding-value-header')).getByTestId('holding-detail-converted'),
    ).toBe(converted);
  });

  it('shows the converted value grouped with the amount, above the breakdown, on a foreign-currency deposit', async () => {
    // The deposit/bond presentation ALSO renders the base-currency line, and it
    // renders it in the SAME place as every other type — inside the value header,
    // directly under the amount and ABOVE the calculation breakdown — so the two
    // presentations read consistently. A USD term_deposit against a UAH base with
    // a cached rate is the case that carries both a breakdown AND a converted line.
    seed(
      { ...depositHolding, currency: 'USD' },
      [],
      [],
      [],
      [{ base: 'USD', quote: 'UAH', rate: '41' }],
      [{ baseCurrency: 'UAH' }],
    );

    const { getByTestId } = await renderScreen();

    const header = getByTestId('holding-value-header');
    // The converted caption is inside the header grouping...
    expect(within(header).getByTestId('holding-detail-converted')).toBeTruthy();
    // ...while the breakdown ("Principal") is NOT — it is a separate block below
    // the header, so the converted line hugs the value rather than floating under
    // the breakdown.
    expect(within(header).queryByText('Principal')).toBeNull();
    expect(getByTestId('holding-detail-converted')).toBeTruthy();
  });

  it('shows no converted value line for a holding already in the base currency', async () => {
    // A UAH holding against a UAH base needs no second figure — the guard
    // (`holding.currency !== baseCurrency`) omits the caption entirely.
    seed(
      { ...cardHolding, currency: 'UAH', balanceMinorUnits: 10_000 },
      [],
      [],
      [],
      [],
      [{ baseCurrency: 'UAH' }],
    );

    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('holding-detail-converted')).toBeNull();
  });

  it('renders a metal holding at its priced value once a metal:XAU price point exists, not its lots’ cost basis', async () => {
    // metalHolding holds 10g at purity 0.999; the priced value (quantity *
    // purity * price / troy-ounce-grams) must override the cost-basis
    // fallback (50 000,00 ₴, from its stored lot) the instant a shared
    // metal:XAU point lands.
    seed(metalHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
      {
        instrument: 'metal:XAU',
        day: Date.UTC(2024, 0, 1),
        price: '2500000.00',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);

    const { getAllByText } = await renderScreen();

    // The priced value now appears twice: the headline Value amount and its
    // own "Value" breakdown row below it — both must read it.
    expect(getAllByText(formatMoney(Money.of('UAH', 80_296_490))).length).toBe(2);
  });

  it('shows a metal holding its cost basis, priced value, and gain in the breakdown, with no interest/tax row', async () => {
    // Cost basis (the stored lot): 10g at 5_000_000 minor units total ->
    // 50 000,00 ₴. Priced value (the same metal:XAU point as above): 80
    // 296 490 minor units -> 802 964,90 ₴. Gain = value - cost.
    seed(metalHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
      {
        instrument: 'metal:XAU',
        day: Date.UTC(2024, 0, 1),
        price: '2500000.00',
        currency: 'UAH',
        source: 'nbu',
      },
    ]);

    const { getByText, getAllByText, queryByText } = await renderScreen();

    expect(getByText('Cost')).toBeTruthy();
    expect(amountForLabel(getByText('Cost'))).toHaveTextContent(
      formatMoney(Money.of('UAH', 5_000_000)),
    );
    // "Value" also labels the headline amount above the breakdown (index 0);
    // the breakdown's own "Value" row is the second match.
    expect(amountForLabel(getAllByText('Value')[1])).toHaveTextContent(
      formatMoney(Money.of('UAH', 80_296_490)),
    );
    expect(getByText('Gain')).toBeTruthy();
    expect(amountForLabel(getByText('Gain'))).toHaveTextContent(
      formatMoney(Money.of('UAH', 75_296_490)),
    );
    expect(queryByText('Interest earned')).toBeNull();
    expect(queryByText('Tax withheld')).toBeNull();
  });

  it('shows a property_item its cost basis, priced value, and gain in the breakdown, with no interest/tax row', async () => {
    // propertyHolding's stored lot cost: 200_000_000 minor units -> 2 000
    // 000,00 ₴. No price_points row is seeded, so `pricedBreakdown` falls
    // back to that same cost basis for the priced value too — the "no price
    // point yet" case — so the gain reads exactly 0,00 ₴.
    seed(propertyHolding);

    const { getByText, getAllByText, queryByText } = await renderScreen();

    expect(amountForLabel(getByText('Cost'))).toHaveTextContent(
      formatMoney(Money.of('UAH', 200_000_000)),
    );
    expect(amountForLabel(getAllByText('Value')[1])).toHaveTextContent(
      formatMoney(Money.of('UAH', 200_000_000)),
    );
    expect(amountForLabel(getByText('Gain'))).toHaveTextContent(formatMoney(Money.of('UAH', 0)));
    expect(queryByText('Interest earned')).toBeNull();
    expect(queryByText('Tax withheld')).toBeNull();
  });

  describe('a shared property', () => {
    const sharedProperty = (share: { numerator: number; denominator: number }, input: string) => ({
      ...propertyHolding,
      metadata: {
        ...propertyHolding.metadata,
        ownership: [{ day: Date.UTC(2025, 5, 1), ...share }],
        ownershipInput: input,
      },
    });
    const wholePricePoint = {
      instrument: 'holding:h-1',
      day: Date.UTC(2024, 0, 1),
      price: '3000000.01',
      currency: 'UAH',
      source: 'manual',
    };
    const seedShared = (share: { numerator: number; denominator: number }, input: string) =>
      seed(sharedProperty(share, input), [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
        wholePricePoint,
      ]);

    it('breaks the value into the whole, the share, and the owned value, cost, and gain', async () => {
      seedShared({ numerator: 1, denominator: 3 }, 'fraction');

      const { getByTestId, getByText, queryByText } = await renderScreen();

      expect(getByText('Whole value')).toBeTruthy();
      expect(getByTestId('ownership-whole-value')).toHaveTextContent(
        formatMoney(Money.of('UAH', 300_000_001)),
      );
      expect(getByText('Your share')).toBeTruthy();
      expect(getByTestId('ownership-share')).toHaveTextContent('1/3 · 33.33% since 01.06.2025');
      expect(getByText('Your value')).toBeTruthy();
      expect(getByTestId('ownership-owned-value')).toHaveTextContent(
        formatMoney(Money.of('UAH', 100_000_000)),
      );
      expect(getByText('Cost (your share)')).toBeTruthy();
      expect(getByTestId('ownership-owned-cost')).toHaveTextContent(
        formatMoney(Money.of('UAH', 66_666_667)),
      );
      expect(getByTestId('ownership-gain')).toHaveTextContent(
        formatMoney(Money.of('UAH', 33_333_333)),
      );
      expect(queryByText('Cost')).toBeNull();
    });

    it('shows a percent-typed share as its percent', async () => {
      seedShared({ numerator: 1, denominator: 2 }, 'percent');

      const { getByTestId } = await renderScreen();

      expect(getByTestId('ownership-share')).toHaveTextContent('50% since 01.06.2025');
    });

    it('keeps the plain Cost, Value, and Gain rows for a property owned whole', async () => {
      seed(propertyHolding);

      const { getByText, queryByText } = await renderScreen();

      expect(getByText('Cost')).toBeTruthy();
      expect(queryByText('Whole value')).toBeNull();
      expect(queryByText('Your share')).toBeNull();
    });

    describe('the share changes list', () => {
      const changeDay = Date.UTC(2025, 5, 1);
      const seedChanges = (metadata: Record<string, unknown>) =>
        seed(
          { ...propertyHolding, metadata: { ...propertyHolding.metadata, ...metadata } },
          [],
          [],
          [],
          [],
          [{ baseCurrency: 'UAH' }],
          undefined,
          [wholePricePoint],
        );
      const holdRow = async (): Promise<void> => {
        await act(async () => {
          fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
            { state: State.BEGAN },
            { state: State.ACTIVE },
            { state: State.END },
          ]);
        });
      };

      it('lists every stored change newest first, in the typed input form', async () => {
        seedChanges({
          ownership: [
            { day: Date.UTC(2024, 0, 1), numerator: 1, denominator: 2 },
            { day: changeDay, numerator: 1, denominator: 3 },
          ],
          ownershipInput: 'fraction',
        });

        const { getByText, getAllByTestId } = await renderScreen();
        const rows = getAllByTestId('share-change-row');

        expect(getByText('Share Changes')).toBeTruthy();
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('01.06.20251/3 · 33.33%');
        expect(rows[1]).toHaveTextContent('01.01.20241/2 · 50%');
      });

      it('shows a percent-typed change as its percent', async () => {
        seedChanges({
          ownership: [{ day: changeDay, numerator: 1, denominator: 2 }],
          ownershipInput: 'percent',
        });

        const { getByTestId } = await renderScreen();

        expect(getByTestId('share-change-row')).toHaveTextContent('01.06.202550%');
      });

      it('is hidden for a property owned whole with no stored change', async () => {
        seed(propertyHolding);

        const { queryByText, queryByTestId } = await renderScreen();

        expect(queryByText('Share Changes')).toBeNull();
        expect(queryByTestId('share-change-row')).toBeNull();
      });

      it('is hidden for a loan given, even with a stored share', async () => {
        seedChanges({
          category: 'loan_given',
          ownership: [{ day: changeDay, numerator: 1, denominator: 3 }],
        });

        const { queryByText } = await renderScreen();

        expect(queryByText('Share Changes')).toBeNull();
      });

      it('opens the edit form for the held change, by holding id and day key', async () => {
        seedChanges({ ownership: [{ day: changeDay, numerator: 1, denominator: 2 }] });

        const { getByTestId } = await renderScreen();

        await holdRow();
        await act(async () => {
          await fireEvent.press(getByTestId(EDIT_ACTION_TEST_ID));
        });

        expect(navigation.navigate).toHaveBeenCalledWith('OwnershipChangeForm', {
          holdingId: 'h-1',
          day: changeDay,
        });
      });

      it('deletes the held change through the named confirm, by holding id and day key', async () => {
        seedChanges({ ownership: [{ day: changeDay, numerator: 1, denominator: 2 }] });

        const { getByTestId, getByText } = await renderScreen();

        await holdRow();
        await act(async () => {
          await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
        });

        expect(getByText('Delete "50% since 01.06.2025"')).toBeTruthy();
        expect(holdingsRepo.removeOwnershipChange).not.toHaveBeenCalled();

        await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

        expect(holdingsRepo.removeOwnershipChange).toHaveBeenCalledWith('h-1', changeDay);
      });
    });
  });

  it('renders the resolved category icon on a transaction row, tinted with its category color', async () => {
    seed(
      cardHolding,
      [
        {
          id: 'txn-cat',
          amountMinorUnits: -5000,
          time: 1,
          description: 'Coffee',
          category: 'Food',
          source: 'manual',
        },
      ],
      [{ key: 'food', title: 'Food', icon: 'fork.knife', color: '#FF5733' }],
    );

    const { getByLabelText } = await renderScreen();

    // The row resolves its stored `category` through the same shared mapping
    // Home uses, so the icon follows the categories table (here `fork.knife`)
    // and carries the category's own color — mirroring Home's transaction row,
    // rather than a flat neutral tone. A hex color passes through
    // `toSFSymbolTintColor` unchanged to the SFSymbolView `tintColor`.
    const icon = getByLabelText('Food');
    expect(icon.props.name).toBe('fork.knife');
    expect(icon.props.tintColor).toBe('#FF5733');
  });

  it('renders the neutral category icon for an empty or unknown category', async () => {
    seed(cardHolding, [
      {
        id: 'txn-none',
        amountMinorUnits: -5000,
        time: 1,
        description: 'Coffee',
        category: null,
        source: 'manual',
      },
    ]);

    const { getByLabelText } = await renderScreen();

    // A null/unresolvable category falls back to the shared neutral display
    // (Uncategorized / creditcard), matching Home's neutral fallback.
    expect(getByLabelText('Uncategorized').props.name).toBe('creditcard');
  });

  // 'dining' is not in the categories table (a deleted seeded category sync
  // keeps re-writing) — `resolveCategoryDisplay` already folds it onto the
  // DEFAULT category's title/icon, and the icon's COLOR must resolve from that
  // same folded key, not the RAW unfolded slug — otherwise an uncolored
  // default category would show a DIFFERENT hash color than every other row
  // folded onto it.
  it('resolves the ledger-row icon color through the same folded key as its title/icon, not the raw unresolvable slug', async () => {
    seed(
      cardHolding,
      [
        {
          id: 'txn-ghost',
          amountMinorUnits: -5000,
          time: 1,
          description: 'Dinner',
          category: 'dining',
          source: 'manual',
        },
      ],
      [{ key: 'other', title: 'Other', icon: 'square.grid.2x2', color: null }],
    );

    const { getByLabelText } = await renderScreen();

    const icon = getByLabelText('Other');

    expect(icon.props.name).toBe('square.grid.2x2');
    expect(icon.props.tintColor).toBe(categoryColor('other'));
  });

  it('opens the transaction form for the tapped row, keyed by its id', async () => {
    seed(cardHolding, [
      { id: 'txn-7', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Coffee'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', { transactionId: 'txn-7' });
  });

  it('wires a manual transaction row to the shared long-press context menu, not a swipe-to-delete row', async () => {
    seed(cardHolding, [
      { id: 'txn-9', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { queryByTestId } = await renderScreen();

    // The delete affordance is the shared CardContextMenu long-press — the row
    // is wrapped in its `card-context-menu` layer and registers the hold
    // gesture — rather than the old SwipeableRow's `*-actions` layer.
    // `getByGestureTestId` throws when the hold gesture is absent, so reaching
    // it asserts the affordance.
    expect(queryByTestId('card-context-menu')).not.toBeNull();
    expect(getByGestureTestId(HOLD_GESTURE_TEST_ID)).toBeTruthy();
    expect(queryByTestId('swipeable-row-actions')).toBeNull();
  });

  it('deletes a manual transaction via the themed deep-press delete confirm', async () => {
    seed(cardHolding, [
      { id: 'txn-9', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { getByTestId, getByText } = await renderScreen();

    // A hold that reaches ACTIVE (stayed still past the min duration, under
    // the max distance) opens the Duplicate/Delete choice; choosing Delete
    // hands off to the themed ConfirmSheet (not a native ActionSheetIOS), whose
    // destructive confirm removes the transaction via `transactionsRepo.remove`.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));
    expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-9');
  });

  it('shows what else deleting a row takes under the confirm title, read from that row plan', async () => {
    jest.mocked(transactionsRepo.removePlan).mockResolvedValue({
      split: false,
      exchange: { kind: 'deleted', names: ['Dollar card'] },
    });
    seed(cardHolding, [
      { id: 'txn-9', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { getByTestId, getByText } = await renderScreen();

    await holdCard();
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(transactionsRepo.removePlan).toHaveBeenCalledWith('txn-9');
    expect(getByText('Delete "Coffee"')).toBeTruthy();
    expect(
      getByText('This also deletes the other part of this exchange, in Dollar card.'),
    ).toBeTruthy();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-9');
  });

  it('duplicates a manual transaction row to a pre-filled create form', async () => {
    seed(cardHolding, [
      { id: 'txn-9', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const { getByTestId } = await renderScreen();

    // A hold opens the Duplicate/Delete choice; Duplicate navigates to the
    // shared form with the `duplicateOfTransactionId` param, never editing or
    // removing the source row.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    await act(async () => {
      await fireEvent.press(getByTestId(DUPLICATE_ACTION_TEST_ID));
    });

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', {
      duplicateOfTransactionId: 'txn-9',
    });
    expect(transactionsRepo.remove).not.toHaveBeenCalled();
  });

  it('does not offer delete on a synced transaction row, only the View action', async () => {
    seed(
      bankCardHolding,
      [
        {
          id: 'txn-mono',
          amountMinorUnits: -5000,
          time: 1,
          description: 'Coffee',
          source: 'monobank',
        },
      ],
      [],
      [],
      [],
      undefined,
      bankAccount,
    );

    const { getByTestId, queryByTestId } = await renderScreen();

    // A synced (Monobank) row is not deletable, so its hold lists View account alone.
    await holdCard();

    expect(getByTestId(VIEW_ACCOUNT_ACTION_TEST_ID)).toBeTruthy();
    expect(queryByTestId(DELETE_ACTION_TEST_ID)).toBeNull();
    expect(queryByTestId(DUPLICATE_ACTION_TEST_ID)).toBeNull();
  });

  describe('an imported transaction row', () => {
    const importedRow = {
      id: 'txn-import',
      amountMinorUnits: -5000,
      time: 5_000,
      description: 'Coffee',
      source: 'import',
    };

    const holdRow = async () => {
      const screen = await renderScreen();

      await holdCard();

      return screen;
    };

    it('lists Delete with View account on a hold, and deletes through transactionsRepo.remove', async () => {
      seed(bankCardHolding, [importedRow], [], [], [], undefined, bankAccount);

      const { getByTestId, getByText, queryByTestId } = await holdRow();

      // An imported row is deletable but not duplicable: View account and Delete.
      expect(queryByTestId(DUPLICATE_ACTION_TEST_ID)).toBeNull();
      expect(getByTestId(VIEW_ACCOUNT_ACTION_TEST_ID)).toBeTruthy();

      await act(async () => {
        await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
      });

      expect(getByText('Delete "Coffee"')).toBeTruthy();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-import');
    });
  });

  describe('the View account and View holding actions', () => {
    const manualRow = {
      id: 'txn-9',
      amountMinorUnits: -5000,
      time: 1,
      description: 'Coffee',
      source: 'manual',
    };

    it('offers View account only on a row of the page’s own holding, opening its account', async () => {
      seed(bankCardHolding, [manualRow], [], [], [], undefined, bankAccount);

      const { getByTestId, queryByTestId } = await renderScreen();

      await holdCard();

      expect(queryByTestId(VIEW_HOLDING_ACTION_TEST_ID)).toBeNull();
      expect(getByTestId(DUPLICATE_ACTION_TEST_ID)).toBeTruthy();
      expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();

      await act(async () => {
        await fireEvent.press(getByTestId(VIEW_ACCOUNT_ACTION_TEST_ID));
      });

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
        accountId: 'bank',
        name: 'Mono',
        kind: 'bank',
      });
    });

    it('offers no hold at all while the holding’s account has not loaded', async () => {
      seed(bankCardHolding, [{ ...manualRow, source: 'monobank' }]);

      const { queryByTestId } = await renderScreen();

      expect(queryByTestId('card-context-menu')).toBeNull();
    });

    describe('a loan’s linked payment', () => {
      const [first] = loanInstallments(shortLoanMeta);
      const loanOnDebts = { ...shortLoanHolding, accountId: 'debts' };
      const payer = {
        id: 'payer-1',
        name: 'Everyday card',
        type: 'card',
        currency: 'UAH',
        accountId: 'bank',
      };
      const linkedRow = {
        id: 'txn-first',
        holdingId: 'payer-1',
        amountMinorUnits: -first.paymentMinorUnits,
        currency: 'UAH',
        time: first.dueDate,
        description: 'First installment',
        source: 'manual',
        loanHoldingId: 'h-1',
        loanLinkSource: 'manual',
      };
      const seedLoanWithLinkedPayment = () =>
        seed(
          loanOnDebts,
          [],
          [],
          [payer],
          [],
          [{ baseCurrency: 'UAH' }],
          debtsAccount,
          [],
          {},
          [linkedRow],
          [bankAccount, debtsAccount],
        );

      it('opens the PAYER holding from View holding', async () => {
        seedLoanWithLinkedPayment();

        const { getByTestId } = await renderScreen();

        await holdCard();
        await act(async () => {
          await fireEvent.press(getByTestId(VIEW_HOLDING_ACTION_TEST_ID));
        });

        expect(mockOpenInPane).toHaveBeenCalledTimes(1);
        expect(mockOpenInPane).toHaveBeenCalledWith('HoldingDetail', {
          holdingId: 'payer-1',
          name: 'Everyday card',
        });
      });

      it('opens the PAYER’s account, not the loan’s, from View account', async () => {
        seedLoanWithLinkedPayment();

        const { getByTestId } = await renderScreen();

        await holdCard();
        await act(async () => {
          await fireEvent.press(getByTestId(VIEW_ACCOUNT_ACTION_TEST_ID));
        });

        expect(mockOpenInPane).toHaveBeenCalledTimes(1);
        expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
          accountId: 'bank',
          name: 'Mono',
          kind: 'bank',
        });
      });

      it('reads the account list for a loan only', async () => {
        const accountListEnabled = (): unknown =>
          mockUseLiveQuery.mock.calls.find(
            (call) => (call[0] as { toSQL: () => { sql: string } }).toSQL().sql === 'accounts-list',
          )?.[2];

        seedLoanWithLinkedPayment();
        await renderScreen();

        expect(accountListEnabled()).toBe(true);

        mockUseLiveQuery.mockClear();
        seed(bankCardHolding, [manualRow], [], [], [], undefined, bankAccount);
        await renderScreen();

        expect(accountListEnabled()).toBe(false);
      });

      it('names the accounts table as the one the account list query reads', async () => {
        seedLoanWithLinkedPayment();
        await renderScreen();

        const accountListCall = mockUseLiveQuery.mock.calls.find(
          (call) => (call[0] as { toSQL: () => { sql: string } }).toSQL().sql === 'accounts-list',
        );

        expect(accountListCall?.[1]).toEqual(['accounts']);
      });

      it('offers the payer’s account once the account list loads after the first render', async () => {
        seed(
          loanOnDebts,
          [],
          [],
          [payer],
          [],
          [{ baseCurrency: 'UAH' }],
          debtsAccount,
          [],
          {},
          [linkedRow],
          [],
        );

        const { getByTestId, rerender } = await renderScreen();

        seedLoanWithLinkedPayment();
        await rerender(screenElement());

        await holdCard();
        await act(async () => {
          await fireEvent.press(getByTestId(VIEW_ACCOUNT_ACTION_TEST_ID));
        });

        expect(mockOpenInPane).toHaveBeenCalledWith('AccountDetail', {
          accountId: 'bank',
          name: 'Mono',
          kind: 'bank',
        });
      });

      it('gives a scheduled payment, which has not happened, no hold', async () => {
        seed(
          loanOnDebts,
          [],
          [],
          [],
          [],
          [{ baseCurrency: 'UAH' }],
          debtsAccount,
          [],
          {},
          [],
          [debtsAccount],
        );

        await renderScreen();

        expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
      });
    });
  });

  it('renders the derived lifecycle rows (opening, accrual, taxes) with Computed as a subtitle', async () => {
    seed(depositHolding);

    const { getAllByTestId, queryByText } = await renderScreen();
    const cards = getAllByTestId('ledger-row');

    // derivedEntries yields the opening deposit plus per-period interest and its
    // two withholding lines. These read distinctly from the value-breakdown
    // labels ("Interest earned"/"Tax withheld"). Every settled derived row
    // carries "Computed" under its title so it reads as derived.
    for (const title of [
      'Opening deposit',
      'Interest accrual',
      'Income tax 18%',
      'Military levy 5%',
    ]) {
      const titled = cardsTitled(cards, title);

      expect(titled.length).toBeGreaterThan(0);

      for (const card of titled) {
        expect(within(card).getByText('Computed')).toBeTruthy();
      }
    }

    expect(queryByText('Opening deposit · Computed')).toBeNull();
  });

  it('puts Computed under a paid bond coupon', async () => {
    seed(bondHolding);

    const { getAllByTestId, queryByText } = await renderScreen();
    const paidCoupons = cardsTitled(
      cardsTitled(getAllByTestId('ledger-row'), 'Coupon'),
      'Computed',
    );

    expect(paidCoupons.length).toBeGreaterThan(0);
    expect(queryByText('Coupon · Computed')).toBeNull();
  });

  it('puts Projected under a bond coupon still ahead', async () => {
    const now = new Date();

    seed({
      ...bondHolding,
      metadata: {
        ...bondHolding.metadata,
        purchaseDate: now.getTime(),
        maturityDate: new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()).getTime(),
      },
    });

    const { getAllByTestId, queryByText } = await renderScreen();
    const coupons = cardsTitled(getAllByTestId('ledger-row'), 'Coupon');

    expect(coupons.length).toBeGreaterThan(0);

    for (const coupon of coupons) {
      expect(within(coupon).getByText('Projected')).toBeTruthy();
    }

    expect(queryByText('Coupon · Projected')).toBeNull();
  });

  // A lot is the user's own entry, unlike a computed one, so its row edits and
  // deletes through the long-press menu.
  describe('a lot row', () => {
    const holdRow = async (): Promise<void> => {
      await act(async () => {
        fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
          { state: State.BEGAN },
          { state: State.ACTIVE },
          { state: State.END },
        ]);
      });
    };

    it('opens the Lot form for the held lot, by holding id and lot index', async () => {
      seed(metalHolding);

      const { getByTestId } = await renderScreen();

      await holdRow();
      await act(async () => {
        await fireEvent.press(getByTestId(EDIT_ACTION_TEST_ID));
      });

      expect(navigation.navigate).toHaveBeenCalledWith('LotForm', {
        holdingId: 'h-1',
        lotIndex: 0,
      });
    });

    it('deletes the held lot through the named confirm', async () => {
      seed(metalHolding);

      const { getByTestId, getByText } = await renderScreen();

      await holdRow();
      await act(async () => {
        await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
      });

      expect(getByText('Delete "Purchase 01.01.2024"')).toBeTruthy();
      expect(holdingsRepo.changeLots).not.toHaveBeenCalled();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(holdingsRepo.changeLots).toHaveBeenCalledWith('h-1', { kind: 'remove', index: 0 });
    });

    it('alerts when the delete is refused', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      (holdingsRepo.changeLots as jest.Mock).mockRejectedValueOnce(new Error('refused'));
      seed(metalHolding);

      const { getByTestId } = await renderScreen();

      await holdRow();
      await act(async () => {
        await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
      });
      await act(async () => {
        await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));
      });

      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.');
      alertSpy.mockRestore();
    });

    it('has no subtitle, since the user entered it', async () => {
      seed(metalHolding);

      const { getByText, queryByText } = await renderScreen();

      expect(getByText('Purchase')).toBeTruthy();
      expect(queryByText(/Computed|Projected|Scheduled/)).toBeNull();
    });

    it('reads Projected in a subtitle under its title when dated ahead', async () => {
      seed({
        ...metalHolding,
        metadata: {
          ...metalHolding.metadata,
          lots: [
            {
              day: Date.UTC(new Date().getUTCFullYear() + 1, 0, 1),
              quantityDelta: '10',
              costMinorUnits: 5_000_000,
            },
          ],
        },
      });

      const { getAllByTestId, queryByText } = await renderScreen();
      const [lot] = cardsTitled(getAllByTestId('ledger-row'), 'Purchase');

      expect(within(lot).getByText('Projected')).toBeTruthy();
      expect(queryByText('Purchase · Projected')).toBeNull();
    });

    // The ledger lists newest first, so the January buy is the last row held.
    it('offers no Delete for a buy a later sale needs', async () => {
      seed({
        ...metalHolding,
        metadata: {
          ...metalHolding.metadata,
          lots: [
            ...metalHolding.metadata.lots,
            { day: Date.UTC(2024, 2, 1), quantityDelta: '-3', costMinorUnits: -1_500_000 },
          ],
        },
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      await holdRow();

      expect(getByTestId(EDIT_ACTION_TEST_ID)).toBeTruthy();
      expect(queryByTestId(DELETE_ACTION_TEST_ID)).toBeNull();
    });
  });

  it('asks to fix a stored sale larger than what was held before it', async () => {
    seed({
      ...metalHolding,
      metadata: {
        ...metalHolding.metadata,
        lots: [
          ...metalHolding.metadata.lots,
          { day: Date.UTC(2024, 1, 1), quantityDelta: '-15', costMinorUnits: -5_000_000 },
        ],
      },
    });

    const { getByTestId } = await renderScreen();

    expect(getByTestId('oversized-sale-notice')).toHaveTextContent(/Edit or delete that sale/);
  });

  it('shows no oversized-sale notice while every sale is covered', async () => {
    seed(metalHolding);

    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('oversized-sale-notice')).toBeNull();
  });

  it('renders derived rows read-only: no context menu and not tappable to the form', async () => {
    seed(depositHolding);

    const { getByText, queryByTestId } = await renderScreen();

    // A derived-only deposit (no real transactions) offers no delete action at
    // all — no row is wrapped in the shared CardContextMenu.
    expect(queryByTestId('card-context-menu')).toBeNull();
    // Pressing a derived row's label opens no transaction form.
    await fireEvent.press(getByText('Opening deposit'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('merges real transactions with derived entries in one ordered ledger', async () => {
    seed(depositHolding, [
      {
        id: 'txn-real',
        amountMinorUnits: -5000,
        time: Date.now(),
        description: 'Fee',
        source: 'manual',
      },
    ]);

    const { getByText, getAllByTestId } = await renderScreen();

    // Both the real transaction and the derived opening deposit render together.
    expect(getByText('Fee')).toBeTruthy();
    expect(getByText('Opening deposit')).toBeTruthy();
    // Only the real row is deletable; the derived rows expose no delete
    // action, so exactly one card-context-menu wrapper renders for the whole
    // ledger.
    expect(getAllByTestId('card-context-menu')).toHaveLength(1);
  });

  it('colors a deposit tax row red and an interest accrual green in the ledger', async () => {
    seed(depositHolding);

    const { getAllByText } = await renderScreen();

    // The 18% income-tax withholding line reads in the negative (red) tone; the
    // interest accrual reads in the positive (green) tone — by KIND, via the
    // derived entry's tone passed through MoneyText, not merely by the amount's
    // sign.
    const taxAmount = amountForLabel(getAllByText('Income tax 18%')[0]);
    expect(taxAmount.props.testID).toBe('money-tone-negative');

    const interestAmount = amountForLabel(getAllByText('Interest accrual')[0]);
    expect(interestAmount.props.testID).toBe('money-tone-positive');
  });

  it('colors the interest-earned and tax-withheld value breakdown lines by kind', async () => {
    seed(depositHolding);

    const { getByText } = await renderScreen();

    // The summary breakdown at the top of the screen colors interest green and
    // tax red by KIND, matching the ledger rows — not the sign-only balance
    // coloring that would leave these positive magnitudes white.
    expect(amountForLabel(getByText('Interest earned')).props.testID).toBe('money-tone-positive');
    expect(amountForLabel(getByText('Tax withheld')).props.testID).toBe('money-tone-negative');
  });

  it('colors a bond coupon green and the expected-profit line green', async () => {
    seed(bondHolding);

    const { getAllByText, getByText } = await renderScreen();

    // A net coupon (money in) reads green as an interest payment.
    const couponAmount = amountForLabel(getAllByText('Coupon')[0]);
    expect(couponAmount.props.testID).toBe('money-tone-positive');

    // The whole-life expected-profit breakdown line reads green as the expected gain.
    const expectedProfitAmount = amountForLabel(getByText('Expected profit'));
    expect(expectedProfitAmount.props.testID).toBe('money-tone-positive');
  });

  it('routes the deposit add-contribution action to the dedicated contribution form', async () => {
    seed(depositHolding);

    const { getByText } = await renderScreen();

    // A deposit top-up now opens its own screen (no inline form on the detail
    // screen); the contribution is filled and persisted there.
    await fireEvent.press(getByText('Add contribution'));

    expect(navigation.navigate).toHaveBeenCalledWith('ContributionForm', { holdingId: 'h-1' });
  });

  it('leads the deposit Add contribution action with a calendar-plus glyph', async () => {
    seed(depositHolding);

    const { getByTestId } = await renderScreen();

    expect(footerGlyphNames(getByTestId('screen-footer'))).toEqual(['calendar.badge.plus']);
  });

  it('hides the footer add action for a bond', async () => {
    seed(bondHolding);

    const { queryByTestId, queryByText } = await renderScreen();

    // A bond carries no manual ledger — its value derives from metadata — so it
    // offers no add action at all: neither the generic "Add transaction" nor a
    // deposit "Add contribution". The Screen renders no footer slot.
    expect(queryByTestId('screen-footer')).toBeNull();
    expect(queryByText('Add transaction')).toBeNull();
    expect(queryByText('Add contribution')).toBeNull();
  });

  it('offers "Update value" instead of a manual add action for a property_item', async () => {
    // property_item is ledgerless (isLedgerlessHoldingType) AND priced — it
    // takes neither the generic "Add transaction" nor a deposit "Add
    // contribution"; instead its footer opens the dedicated price-point form
    // to record a revaluation.
    seed(propertyHolding);

    const { getByTestId, queryByText } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Update value')).toBeTruthy();
    expect(queryByText('Add transaction')).toBeNull();
    expect(queryByText('Add contribution')).toBeNull();
  });

  it('keeps "Update value" text-only (it adds no entity, so it carries no glyph)', async () => {
    seed(propertyHolding);

    const { getByTestId } = await renderScreen();

    expect(footerGlyphNames(getByTestId('screen-footer'))).toEqual([]);
  });

  it('navigates to PricePointForm on "Update value"', async () => {
    seed(propertyHolding);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Update value'));

    expect(navigation.navigate).toHaveBeenCalledWith('PricePointForm', { holdingId: 'h-1' });
  });

  // A property_item (ledgerless, no derived lifecycle entries) with no real
  // transactions must not leave a bare "Transactions" heading with nothing
  // below it — the same ListEmptyComponent pattern `home.screen.tsx` uses.
  it('shows the empty-transactions state for a property_item with no real transactions', async () => {
    seed(propertyHolding);

    const { getByText, queryAllByTestId } = await renderScreen();

    expect(queryAllByTestId('ledger-row')).toHaveLength(0);
    expect(getByText('No transactions')).toBeTruthy();
  });

  it('offers "Add lot" instead of a manual add action for a metal holding', async () => {
    // metal is ledgerless (isLedgerlessHoldingType) AND lot-form-eligible —
    // unlike property_item it does NOT take "Update value": its price comes
    // from the shared metal:<XAU|...> instrument (kiko-pricing), never a
    // per-holding manual price point.
    seed(metalHolding);

    const { getByTestId, queryByText } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add lot')).toBeTruthy();
    expect(queryByText('Update value')).toBeNull();
    expect(queryByText('Add transaction')).toBeNull();
    expect(queryByText('Add contribution')).toBeNull();
  });

  it('leads the Add lot action with the metal cube glyph', async () => {
    seed(metalHolding);

    const { getByTestId } = await renderScreen();

    expect(footerGlyphNames(getByTestId('screen-footer'))).toEqual(['cube.fill']);
  });

  it('navigates to LotForm on "Add lot"', async () => {
    seed(metalHolding);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add lot'));

    expect(navigation.navigate).toHaveBeenCalledWith('LotForm', { holdingId: 'h-1' });
  });

  it('shows a lot holding its cost, value, and a negative gain when the price fell', async () => {
    seed(pricedLotHolding, [], [], [], [], [{ baseCurrency: 'USD' }], undefined, [
      {
        instrument: 'holding:h-1',
        day: Date.UTC(2024, 0, 1),
        price: '250',
        currency: 'USD',
        source: 'manual',
      },
    ]);

    const { getByText, getAllByText } = await renderScreen();
    const dollar = /\$/;

    expect(amountForLabel(getByText('Cost'), dollar)).toHaveTextContent(
      formatMoney(Money.of('USD', 90_000)),
    );
    expect(amountForLabel(getAllByText('Value')[1], dollar)).toHaveTextContent(
      formatMoney(Money.of('USD', 75_000)),
    );
    expect(amountForLabel(getByText('Gain'), dollar)).toHaveTextContent(
      formatMoney(Money.of('USD', -15_000)),
    );
  });

  it('offers "Update outstanding" instead of a manual add action for a loan', async () => {
    // A loan is ledgerless, but — unlike a plain ledgerless type (bond) —
    // still takes an "Update outstanding" footer action: it writes a
    // correction onto its own manual outstanding series.
    seed(annuityLoanHolding);

    const { getByTestId, queryByText } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Update outstanding')).toBeTruthy();
    expect(queryByText('Update value')).toBeNull();
    expect(queryByText('Add transaction')).toBeNull();
    expect(queryByText('Add contribution')).toBeNull();
  });

  it('navigates to PricePointForm on "Update outstanding"', async () => {
    seed(annuityLoanHolding);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Update outstanding'));

    expect(navigation.navigate).toHaveBeenCalledWith('PricePointForm', { holdingId: 'h-1' });
  });

  it('shows the loan outstanding amount as negative in the Value header', async () => {
    // A 'none' (informal) loan's outstanding reads directly from its manual
    // holding:<id> price-point series — seeding one gives a
    // deterministic figure, independent of the real test-run date.
    seed(noneLoanHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
      {
        instrument: 'holding:h-1',
        day: Date.UTC(2020, 0, 1),
        price: '7500.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    const { getByText } = await renderScreen();

    expect(getByText(formatMoney(Money.of('UAH', -750_000)))).toBeTruthy();
  });

  it('shows the loan ledger breakdown from the linked payments, with the same outstanding as the Value', async () => {
    const [first] = loanInstallments(annuityLoanMeta);
    seed(
      annuityLoanHolding,
      [],
      [],
      [{ id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' }],
      [],
      [{ baseCurrency: 'UAH' }],
      undefined,
      [],
      {},
      [
        {
          id: 'txn-first',
          holdingId: 'payer-1',
          amountMinorUnits: -first.paymentMinorUnits,
          currency: 'UAH',
          time: first.dueDate,
          description: 'First installment',
          source: 'manual',
          loanHoldingId: 'h-1',
          loanLinkSource: 'auto',
        },
      ],
    );

    const { getByTestId, getByText } = await renderScreen();
    const outstanding = annuityLoanMeta.principalMinorUnits - first.principalMinorUnits;
    const money = (minorUnits: number) => formatMoney(Money.of('UAH', minorUnits));

    expect(getByText('Paid so far')).toBeTruthy();
    expect(getByTestId('loan-ledger-principal')).toHaveTextContent(
      money(annuityLoanMeta.principalMinorUnits),
    );
    expect(getByTestId('loan-ledger-paid-so-far')).toHaveTextContent(
      money(first.paymentMinorUnits),
    );
    expect(getByTestId('loan-ledger-interest-paid')).toHaveTextContent(
      money(first.interestMinorUnits),
    );
    expect(getByTestId('loan-ledger-principal-repaid')).toHaveTextContent(
      money(first.principalMinorUnits),
    );
    expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(money(outstanding));
    expect(within(getByTestId('holding-value-header')).getByText(money(-outstanding))).toBeTruthy();
  });

  it('shows the ledger breakdown for a "none" schedule loan too', async () => {
    seed(noneLoanHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
      {
        instrument: 'holding:h-1',
        day: Date.UTC(2020, 0, 1),
        price: '7500.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    const { getByTestId } = await renderScreen();

    expect(getByTestId('loan-ledger-principal')).toHaveTextContent(
      formatMoney(Money.of('UAH', 10_000_00)),
    );
    expect(getByTestId('loan-ledger-paid-so-far')).toHaveTextContent(
      formatMoney(Money.of('UAH', 0)),
    );
    expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(
      formatMoney(Money.of('UAH', 7_500_00)),
    );
  });

  describe('the loan breakdown rows around zero interest', () => {
    const zeroRateMeta: LoanMeta = {
      kind: 'car_loan',
      principalMinorUnits: 12_000_00,
      startDate: startMonthsAgo(12),
      schedule: 'annuity',
      annualRatePct: 0,
      termMonths: 12,
    };

    const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));

    const seedLoanWithPayments = (meta: LoanMeta, paidMinorUnits: number[]): void => {
      const [first] = loanInstallments(meta);

      seed(
        { ...annuityLoanHolding, metadata: meta },
        [],
        [],
        [{ id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' }],
        [],
        [{ baseCurrency: 'UAH' }],
        undefined,
        [],
        {},
        paidMinorUnits.map((paid) => ({
          id: 'txn-first',
          holdingId: 'payer-1',
          amountMinorUnits: -paid,
          currency: 'UAH',
          time: first.dueDate,
          description: 'First installment',
          source: 'manual',
          loanHoldingId: 'h-1',
          loanLinkSource: 'auto',
        })),
      );
    };

    it('hides Principal repaid and keeps Interest paid at 0.00 for a 0% loan with no fee', async () => {
      seedLoanWithPayments(zeroRateMeta, [1_000_00]);

      const { getByTestId, queryByTestId, queryByText } = await renderScreen();

      expect(getByTestId('loan-ledger-paid-so-far')).toHaveTextContent(money(1_000_00));
      expect(getByTestId('loan-ledger-interest-paid')).toHaveTextContent(money(0));
      expect(queryByTestId('loan-ledger-principal-repaid')).toBeNull();
      expect(queryByText('Principal repaid')).toBeNull();
    });

    it('hides Principal repaid for a loan with no payments, where it equals Paid so far at 0', async () => {
      seedLoanWithPayments(zeroRateMeta, []);

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('loan-ledger-paid-so-far')).toHaveTextContent(money(0));
      expect(getByTestId('loan-ledger-interest-paid')).toHaveTextContent(money(0));
      expect(queryByTestId('loan-ledger-principal-repaid')).toBeNull();
    });

    it('keeps Principal repaid next to Paid so far for a 0% loan with a fee', async () => {
      seedLoanWithPayments(zeroRateMeta, [1_005_00]);

      const { getByTestId } = await renderScreen();

      expect(getByTestId('loan-ledger-paid-so-far')).toHaveTextContent(money(1_005_00));
      expect(getByTestId('loan-ledger-interest-paid')).toHaveTextContent(money(0));
      expect(getByTestId('loan-ledger-principal-repaid')).toHaveTextContent(money(1_000_00));
    });

    it('shows both rows when the loan carries interest', async () => {
      const [first] = loanInstallments(annuityLoanMeta);

      seedLoanWithPayments(annuityLoanMeta, [first.paymentMinorUnits]);

      const { getByTestId, getByText } = await renderScreen();

      expect(getByTestId('loan-ledger-interest-paid')).toHaveTextContent(
        formatMoney(Money.of('UAH', first.interestMinorUnits)),
      );
      expect(getByTestId('loan-ledger-principal-repaid')).toHaveTextContent(
        formatMoney(Money.of('UAH', first.principalMinorUnits)),
      );
      expect(getByText('Principal repaid')).toBeTruthy();
    });
  });

  it('shows Interest earned at 0 for a deposit that has accrued nothing', async () => {
    seed({
      ...depositHolding,
      metadata: { ...depositHolding.metadata, annualRatePct: 0 },
    });

    const { getByText } = await renderScreen();

    expect(amountForLabel(getByText('Interest earned'))).toHaveTextContent(
      formatMoney(Money.of('UAH', 0)),
    );
    expect(amountForLabel(getByText('Interest earned')).props.testID).toBe('money-tone-muted');
  });

  it('shows Interest earned for a bond whose coupon is 0%', async () => {
    seed({
      ...bondHolding,
      metadata: { ...bondHolding.metadata, couponPct: 0 },
    });

    const { getByText } = await renderScreen();

    expect(getByText('Interest earned')).toBeTruthy();
    expect(amountForLabel(getByText('Interest earned')).props.testID).toBe('money-tone-muted');
  });

  describe('the loan payments list', () => {
    const payer = { id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' };

    const upcomingOf = (meta: LoanMeta) =>
      loanInstallments(meta).filter((row) => row.dueDate >= startOfLocalDay(Date.now()));

    const linkedPayment = (id: string, time: number, description: string) => ({
      id,
      holdingId: 'payer-1',
      amountMinorUnits: -100_000,
      time,
      description,
      source: 'manual',
      loanHoldingId: 'h-1',
      loanLinkSource: 'manual',
    });

    const seedLoan = (holding: unknown, linked: unknown[] = [], pricePoints: unknown[] = []) =>
      seed(
        holding,
        [],
        [],
        [payer],
        [],
        [{ baseCurrency: 'UAH' }],
        undefined,
        pricePoints,
        {},
        linked,
      );

    it('lists the scheduled and the linked payments in one list, newest first', async () => {
      const [one, two] = loanInstallments(shortLoanMeta);
      const upcoming = upcomingOf(shortLoanMeta);

      seedLoan(shortLoanHolding, [
        linkedPayment('txn-older', one.dueDate, 'First installment'),
        linkedPayment('txn-newer', two.dueDate, 'Second installment'),
      ]);

      const { getAllByText, getAllByTestId } = await renderScreen();

      expect(upcoming.length).toBeGreaterThan(0);
      // The farthest scheduled payment is on top, the oldest linked one at the bottom.
      expect(
        getAllByText(/^(Loan payment|First installment|Second installment)$/).map(
          (node) => node.props.children,
        ),
      ).toEqual([...upcoming.map(() => 'Loan payment'), 'Second installment', 'First installment']);
      expect(getAllByTestId(/^scheduled-payment-/).map((node) => node.props.testID)).toEqual(
        upcoming.map((row) => `scheduled-payment-${row.index}`).reverse(),
      );
      expect(getAllByTestId('ledger-row-loan-link-marker')).toHaveLength(2);
    });

    it('keys every scheduled payment of the list on its own', async () => {
      seedLoan(shortLoanHolding);

      const { getAllByTestId, root } = await renderScreen();
      const list = root?.queryAll(
        (node) =>
          node.props.testID === 'ledger-list' && typeof node.props.keyExtractor === 'function',
      )[0];
      const items: { row: { kind: string } }[] = list?.props.data ?? [];
      const scheduledKeys = items
        .filter((item) => item.row.kind === 'scheduled')
        .map((item) => list?.props.keyExtractor(item, 0));

      expect(getAllByTestId(/^scheduled-payment-/).length).toBeGreaterThan(1);
      expect(scheduledKeys).toHaveLength(getAllByTestId(/^scheduled-payment-/).length);
      expect(new Set(scheduledKeys).size).toBe(scheduledKeys.length);
      expect(scheduledKeys.every((key) => typeof key === 'string' && key !== '')).toBe(true);
    });

    it('heads every day of the one list with a day header, scheduled days included', async () => {
      const [one, two] = loanInstallments(shortLoanMeta);
      const upcoming = upcomingOf(shortLoanMeta);

      seedLoan(shortLoanHolding, [
        linkedPayment('txn-older', one.dueDate, 'First installment'),
        linkedPayment('txn-newer', two.dueDate, 'Second installment'),
      ]);

      const { getAllByTestId, getByText } = await renderScreen();

      expect(getAllByTestId('ledger-day-header')).toHaveLength(upcoming.length + 2);
      expect(getByText(formatDate(two.dueDate))).toBeTruthy();
      // The farthest one: the nearest may fall on today, whose header reads "Today".
      expect(getByText(formatDate(upcoming[upcoming.length - 1].dueDate))).toBeTruthy();
    });

    it('shows the next 12 scheduled payments behind a Show all toggle, and all of them on Show all', async () => {
      const upcoming = upcomingOf(annuityLoanMeta);

      seedLoan(annuityLoanHolding, [
        linkedPayment('txn-older', 1_000, 'First installment'),
        linkedPayment('txn-newer', 2_000, 'Second installment'),
      ]);

      const { getByTestId, getAllByTestId } = await renderScreen();
      // Newest first: the list opens on its farthest scheduled payment, and the FlatList mounts
      // only its first rows, so the top row names where the shown payments end.
      const topScheduled = () => getAllByTestId(/^scheduled-payment-/)[0].props.testID;

      expect(upcoming.length).toBeGreaterThan(12);
      expect(topScheduled()).toBe(`scheduled-payment-${upcoming[11].index}`);
      expect(within(getByTestId('scheduled-payments-toggle')).getByText('Show all')).toBeTruthy();

      await fireEvent.press(getByTestId('scheduled-payments-toggle'));

      expect(topScheduled()).toBe(`scheduled-payment-${upcoming[upcoming.length - 1].index}`);
      expect(within(getByTestId('scheduled-payments-toggle')).getByText('Show less')).toBeTruthy();

      await fireEvent.press(getByTestId('scheduled-payments-toggle'));

      expect(topScheduled()).toBe(`scheduled-payment-${upcoming[11].index}`);
    });

    it('draws the Show all toggle at the top of the scheduled payments, under the heading', async () => {
      seedLoan(annuityLoanHolding, [linkedPayment('txn-older', 1_000, 'First installment')]);

      const { getByTestId } = await renderScreen();
      const tree = JSON.stringify(layoutOf(getByTestId('ledger-list')));
      const positionOf = (text: string): number => tree.indexOf(text);

      expect(positionOf('holding-detail-transactions-divider')).toBeLessThan(
        positionOf('"Transactions"'),
      );
      expect(positionOf('"Transactions"')).toBeLessThan(positionOf('scheduled-payments-toggle'));
      expect(positionOf('scheduled-payments-toggle')).toBeLessThan(positionOf('"Loan payment"'));
    });

    it('offers no toggle when the scheduled payments already fit', async () => {
      seedLoan(shortLoanHolding);

      const { getAllByTestId, queryByTestId } = await renderScreen();

      expect(getAllByTestId(/^scheduled-payment-/).length).toBeGreaterThan(0);
      expect(queryByTestId('scheduled-payments-toggle')).toBeNull();
    });

    it('draws a scheduled payment as a dimmed card with its marker as a subtitle, its split and what remains', async () => {
      seedLoan(shortLoanHolding, [linkedPayment('txn-older', 1_000, 'First installment')]);

      const { getAllByTestId, getByTestId, queryByText } = await renderScreen();
      const [next] = upcomingOf(shortLoanMeta);
      const card = getByTestId(`scheduled-payment-${next.index}`);

      expect(within(card).getByText('Loan payment')).toBeTruthy();
      expect(within(card).getByText('Scheduled')).toBeTruthy();
      expect(within(card).getByText(/^Principal .* · interest /)).toBeTruthy();
      expect(within(card).getByText(/^Remaining /)).toBeTruthy();
      expect(within(card).queryByText(/^\d{2}:\d{2}$/)).toBeNull();
      expect(queryByText('Loan payment · Scheduled')).toBeNull();

      for (const scheduled of getAllByTestId(/^scheduled-payment-/)) {
        expect(StyleSheet.flatten(scheduled.props.style)).toMatchObject({ opacity: 0.5 });
      }
      expect(StyleSheet.flatten(getAllByTestId('ledger-row')[0].props.style)).not.toHaveProperty(
        'opacity',
      );
    });

    it('names the payer holding on a linked payment that has no description', async () => {
      seedLoan(shortLoanHolding, [linkedPayment('txn-older', 1_000, '')]);

      const { getByText, queryByText } = await renderScreen();

      expect(getByText('Everyday card expense')).toBeTruthy();
      expect(queryByText('Car loan expense')).toBeNull();
    });
  });

  describe("a linked payment's split and the balance left after it", () => {
    const payer = { id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' };
    const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));
    const zeroRateMeta: LoanMeta = { ...annuityLoanMeta, annualRatePct: 0, termMonths: 12 };

    const paymentOf = (
      id: string,
      time: number,
      amountMinorUnits: number,
      description: string,
    ) => ({
      id,
      holdingId: 'payer-1',
      amountMinorUnits,
      currency: 'UAH',
      time,
      description,
      source: 'manual',
      loanHoldingId: 'h-1',
      loanLinkSource: 'manual',
    });

    const seedLoan = (meta: LoanMeta, linked: unknown[], pricePoints: unknown[] = []): void =>
      seed(
        { ...annuityLoanHolding, metadata: meta },
        [],
        [],
        [payer],
        [],
        [{ baseCurrency: 'UAH' }],
        undefined,
        pricePoints,
        {},
        linked,
      );

    it('shows the split and the balance of a payment linked after the first render', async () => {
      const [one] = loanInstallments(shortLoanMeta);

      seedLoan(shortLoanMeta, []);

      const { getAllByTestId, rerender } = await renderScreen();

      seedLoan(shortLoanMeta, [
        paymentOf('txn-first', one.dueDate, -one.paymentMinorUnits, 'First installment'),
      ]);
      await rerender(screenElement());

      const [linked] = getAllByTestId('ledger-row');

      expect(
        within(linked).getByText(
          `Principal ${money(one.principalMinorUnits)} · interest ${money(one.interestMinorUnits)}`,
        ),
      ).toBeTruthy();
      expect(within(linked).getByText(`Remaining ${money(one.balanceMinorUnits)}`)).toBeTruthy();
    });

    it('shows the payment own principal and interest and the balance left right after it', async () => {
      const [one, two] = loanInstallments(shortLoanMeta);

      seedLoan(shortLoanMeta, [
        paymentOf('txn-older', one.dueDate, -one.paymentMinorUnits, 'First installment'),
        paymentOf('txn-newer', two.dueDate, -two.paymentMinorUnits, 'Second installment'),
      ]);

      const { getAllByTestId } = await renderScreen();
      const [newer, older] = getAllByTestId('ledger-row');

      expect(
        within(newer).getByText(
          `Principal ${money(two.principalMinorUnits)} · interest ${money(two.interestMinorUnits)}`,
        ),
      ).toBeTruthy();
      expect(within(newer).getByText(`Remaining ${money(two.balanceMinorUnits)}`)).toBeTruthy();
      expect(
        within(older).getByText(
          `Principal ${money(one.principalMinorUnits)} · interest ${money(one.interestMinorUnits)}`,
        ),
      ).toBeTruthy();
      expect(within(older).getByText(`Remaining ${money(one.balanceMinorUnits)}`)).toBeTruthy();
    });

    it('ends on the loan outstanding the Value header shows', async () => {
      const [one, two] = loanInstallments(shortLoanMeta);

      seedLoan(shortLoanMeta, [
        paymentOf('txn-older', one.dueDate, -one.paymentMinorUnits, 'First installment'),
        paymentOf('txn-newer', two.dueDate, -two.paymentMinorUnits, 'Second installment'),
      ]);

      const { getAllByTestId, getByTestId } = await renderScreen();
      const [newer] = getAllByTestId('ledger-row');

      expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(
        money(two.balanceMinorUnits),
      );
      expect(within(newer).getByText(`Remaining ${money(two.balanceMinorUnits)}`)).toBeTruthy();
    });

    it('names only the principal when the payment carries no interest', async () => {
      const [first] = loanInstallments(zeroRateMeta);

      seedLoan(zeroRateMeta, [
        paymentOf('txn-first', first.dueDate, -first.paymentMinorUnits, 'First installment'),
      ]);

      const { getAllByTestId, queryByText } = await renderScreen();
      const [card] = getAllByTestId('ledger-row');

      expect(within(card).getByText(`Principal ${money(first.principalMinorUnits)}`)).toBeTruthy();
      expect(within(card).getByText(`Remaining ${money(first.balanceMinorUnits)}`)).toBeTruthy();
      expect(queryByText(/interest/)).toBeNull();
    });

    // A 12-month loan that started 12 months ago has no scheduled row left, so every split and
    // balance line on the screen belongs to a linked card.
    it('shows no split and no balance on a payment dated before the loan start', async () => {
      const [first] = loanInstallments(zeroRateMeta);

      seedLoan(zeroRateMeta, [
        paymentOf('txn-early', first.dueDate - 2 * DAY_MS, -50_000, 'Early installment'),
        paymentOf('txn-first', first.dueDate, -first.paymentMinorUnits, 'First installment'),
      ]);

      const { getAllByTestId, getAllByText } = await renderScreen();

      expect(getAllByTestId('ledger-row')).toHaveLength(2);
      expect(getAllByText(/^Principal /)).toHaveLength(1);
      expect(getAllByText(/^Remaining /)).toHaveLength(1);
    });

    it('counts the balance of the payment after a correction from that correction', async () => {
      const [one, two] = loanInstallments(shortLoanMeta);
      const correction = {
        instrument: 'holding:h-1',
        day: dayKeyOf(one.dueDate + 5 * DAY_MS),
        price: '80000.00',
        currency: 'UAH' as const,
        source: 'manual' as const,
      };

      seedLoan(
        shortLoanMeta,
        [
          paymentOf('txn-older', one.dueDate, -one.paymentMinorUnits, 'First installment'),
          paymentOf('txn-newer', two.dueDate, -two.paymentMinorUnits, 'Second installment'),
        ],
        [correction],
      );

      const { getAllByTestId, getByTestId } = await renderScreen();
      const [newer, older] = getAllByTestId('ledger-row');

      expect(within(older).getByText(`Remaining ${money(one.balanceMinorUnits)}`)).toBeTruthy();
      expect(
        within(newer).getByText(`Remaining ${money(8_000_000 - two.principalMinorUnits)}`),
      ).toBeTruthy();
      expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(
        money(8_000_000 - two.principalMinorUnits),
      );
    });
  });

  describe('the balance left after the next payment', () => {
    // A due day that is never today, so the first listed row is not the one the header counted.
    // The term leaves only a few installments, so the whole list mounts in the FlatList's first
    // render window.
    const awayFromToday = (): LoanMeta => {
      const now = new Date();
      const dueDay = ((now.getDate() + 14) % 28) + 1;

      return {
        ...annuityLoanMeta,
        startDate: new Date(now.getFullYear(), now.getMonth() - 12, dueDay).getTime(),
        termMonths: 15,
      };
    };

    const LOAN = { id: 'h-1', currency: 'UAH' as const };
    const money = (minorUnits: number) => formatMoney(Money.of('UAH', minorUnits));
    const nextRowOf = (meta: LoanMeta) => {
      const next = loanInstallments(meta).find((row) => row.dueDate >= startOfLocalDay(Date.now()));

      if (next === undefined) {
        throw new Error('fixture must have an upcoming installment');
      }

      return next;
    };

    it('equals the header outstanding less the next payment principal after a correction', async () => {
      const meta = awayFromToday();
      const holding = { ...annuityLoanHolding, metadata: meta };
      const correction = {
        instrument: 'holding:h-1',
        day: dayKeyOf(addMonths(meta.startDate, 6)),
        price: '80000.00',
        currency: 'UAH' as const,
        source: 'manual' as const,
      };
      const outstanding = loanLedgerOutstandingMinorAt(
        meta,
        LOAN,
        buildPriceBook([correction]),
        Date.now(),
      );
      const next = nextRowOf(meta);

      seed(holding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [correction]);

      const { getByTestId } = await renderScreen();

      expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(money(outstanding));
      expect(getByTestId(`scheduled-payment-${next.index}`)).toHaveTextContent(
        `Remaining ${money(outstanding - next.principalMinorUnits)}`,
        { exact: false },
      );
    });

    it('equals the header outstanding less the next payment principal after a linked payment', async () => {
      const meta = awayFromToday();
      const holding = { ...annuityLoanHolding, metadata: meta };
      const paid = loanInstallments(meta)[6];
      const payment = {
        transactionId: 'payment-1',
        loanHoldingId: 'h-1',
        time: paid.dueDate,
        amountMinorUnits: -paid.paymentMinorUnits,
        currency: 'UAH' as const,
      };
      const outstanding = loanLedgerOutstandingMinorAt(
        meta,
        LOAN,
        buildPriceBook([], [payment]),
        Date.now(),
      );
      const next = nextRowOf(meta);

      seed(
        holding,
        [],
        [],
        [{ id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' }],
        [],
        [{ baseCurrency: 'UAH' }],
        undefined,
        [],
        {},
        [
          {
            id: 'txn-paid',
            holdingId: 'payer-1',
            amountMinorUnits: payment.amountMinorUnits,
            currency: 'UAH',
            time: payment.time,
            description: 'Installment',
            source: 'manual',
            loanHoldingId: 'h-1',
            loanLinkSource: 'manual',
          },
        ],
      );

      const { getByTestId } = await renderScreen();

      expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(money(outstanding));
      expect(getByTestId(`scheduled-payment-${next.index}`)).toHaveTextContent(
        `Remaining ${money(outstanding - next.principalMinorUnits)}`,
        { exact: false },
      );
    });

    it('equals the header outstanding less the next payment principal for the schedule alone', async () => {
      const meta = awayFromToday();
      const holding = { ...annuityLoanHolding, metadata: meta };
      const outstanding = loanLedgerOutstandingMinorAt(meta, LOAN, EMPTY_PRICE_BOOK, Date.now());
      const next = nextRowOf(meta);

      seed(holding);

      const { getByTestId } = await renderScreen();

      expect(getByTestId('loan-ledger-outstanding')).toHaveTextContent(money(outstanding));
      expect(getByTestId(`scheduled-payment-${next.index}`)).toHaveTextContent(
        `Remaining ${money(outstanding - next.principalMinorUnits)}`,
        { exact: false },
      );
    });
  });

  it('bounds a 30-year mortgage to its next 12 scheduled payments, and Show all reveals all 360', async () => {
    const thirtyYearMeta: LoanMeta = { ...annuityLoanMeta, startDate: Date.now(), termMonths: 360 };

    seed({ ...annuityLoanHolding, metadata: thirtyYearMeta });

    const { getByTestId, getAllByTestId } = await renderScreen();
    const upcoming = loanInstallments(thirtyYearMeta).filter(
      (row) => row.dueDate >= startOfLocalDay(Date.now()),
    );
    const topScheduled = () => getAllByTestId(/^scheduled-payment-/)[0].props.testID;

    expect(upcoming).toHaveLength(360);
    expect(topScheduled()).toBe(`scheduled-payment-${upcoming[11].index}`);

    await fireEvent.press(getByTestId('scheduled-payments-toggle'));

    expect(topScheduled()).toBe(`scheduled-payment-${upcoming[359].index}`);
  });

  it('shows no scheduled payments for a "none" schedule loan', async () => {
    seed(noneLoanHolding);

    const { queryByTestId } = await renderScreen();

    expect(queryByTestId(/^scheduled-payment/)).toBeNull();
  });

  it('shows no scheduled payments for a non-loan holding', async () => {
    seed(propertyHolding);

    const { queryByTestId } = await renderScreen();

    expect(queryByTestId(/^scheduled-payment/)).toBeNull();
  });

  // An overpaid correction clamps the outstanding to 0 even though
  // `loanInstallments` still has future rows on the schedule — the list must
  // not keep showing payments once the debt is actually paid off.
  it('shows no scheduled payments once a correction clamps the outstanding to 0', async () => {
    seed(annuityLoanHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
      { instrument: 'holding:h-1', day: dayKeyOf(Date.now()), price: '0.00', currency: 'UAH' },
    ]);

    const { queryByTestId } = await renderScreen();

    expect(queryByTestId(/^scheduled-payment/)).toBeNull();
    expect(queryByTestId('scheduled-payments-toggle')).toBeNull();
  });

  describe('the loan list around its heading and its empty state', () => {
    const payer = { id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' };

    const linkedPayment = {
      id: 'txn-1',
      holdingId: 'payer-1',
      amountMinorUnits: -100_000,
      time: 1_000,
      description: 'First installment',
      source: 'manual',
      loanHoldingId: 'h-1',
      loanLinkSource: 'manual',
    };

    const seedLoan = (holding: unknown, linked: unknown[] = []) =>
      seed(holding, [], [], [payer], [], [{ baseCurrency: 'UAH' }], undefined, [], {}, linked);

    it('draws the breakdown, then the Transactions heading, then the payments', async () => {
      seedLoan(shortLoanHolding, [linkedPayment]);

      const { getAllByText } = await renderScreen();

      expect(
        getAllByText(/^(Interest paid|Transactions|Loan payment|Scheduled|First installment)$/)
          .map((node) => String(node.children))
          .filter((text, position, texts) => texts.indexOf(text) === position),
      ).toEqual([
        'Interest paid',
        'Transactions',
        'Loan payment',
        'Scheduled',
        'First installment',
      ]);
    });

    it('opens the list with the Transactions Divider and heading, and no section of its own', async () => {
      seedLoan(annuityLoanHolding, [linkedPayment]);

      const { getByTestId, getByText, queryByTestId, queryByText } = await renderScreen();
      const tree = JSON.stringify(layoutOf(getByTestId('ledger-list')));

      expect(getByTestId('holding-detail-transactions-divider')).toBeTruthy();
      expect(tree.indexOf('holding-detail-transactions-divider')).toBeLessThan(
        tree.indexOf('"Transactions"'),
      );
      expect(getByText('Transactions')).toBeTruthy();
      expect(queryByText('Linked Payments')).toBeNull();
      expect(queryByText('Upcoming Payments')).toBeNull();
      expect(queryByTestId('holding-detail-linked-payments-divider')).toBeNull();
      expect(queryByTestId('upcoming-payments')).toBeNull();
    });

    it('shows the empty state under the heading for a loan with no rows at all', async () => {
      seedLoan(noneLoanHolding);

      const { getByText, getByTestId, queryByText } = await renderScreen();

      expect(getByText('Transactions')).toBeTruthy();
      expect(getByTestId('holding-detail-transactions-divider')).toBeTruthy();
      expect(getByTestId('holding-detail-loan-payments-empty')).toBeTruthy();
      expect(getByText('No payments yet')).toBeTruthy();
      expect(getByText('Linked and scheduled payments appear here.')).toBeTruthy();
      expect(queryByText('No transactions')).toBeNull();
      expect(queryByText('No linked payments')).toBeNull();
    });

    it('shows no empty state for a loan with linked payments and no schedule', async () => {
      seedLoan(noneLoanHolding, [linkedPayment]);

      const { getByText, queryByTestId, queryByText } = await renderScreen();

      expect(getByText('First installment')).toBeTruthy();
      expect(queryByTestId('holding-detail-loan-payments-empty')).toBeNull();
      expect(queryByText('No payments yet')).toBeNull();
      expect(queryByTestId(/^scheduled-payment/)).toBeNull();
    });

    it('shows no empty state for a loan with a schedule and no linked payments', async () => {
      seedLoan(annuityLoanHolding);

      const { getAllByTestId, queryByTestId, queryByText } = await renderScreen();

      expect(getAllByTestId(/^scheduled-payment-/).length).toBeGreaterThan(0);
      expect(queryByTestId('holding-detail-loan-payments-empty')).toBeNull();
      expect(queryByText('No payments yet')).toBeNull();
    });

    it('shows the empty state for a repaid loan that has no linked payments', async () => {
      seed(annuityLoanHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
        { instrument: 'holding:h-1', day: dayKeyOf(Date.now()), price: '0.00', currency: 'UAH' },
      ]);

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('holding-detail-loan-payments-empty')).toBeTruthy();
      expect(queryByTestId(/^scheduled-payment/)).toBeNull();
    });

    it('shows no empty state while the linked payments load', async () => {
      seed(annuityLoanHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [], {
        linkedLoanPayments: true,
      });

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(getByTestId('holding-detail-loading')).toBeTruthy();
      expect(queryByTestId('holding-detail-loan-payments-empty')).toBeNull();
    });

    it('keeps the Transactions divider, heading and empty text for a non-loan holding', async () => {
      seed(propertyHolding);

      const { getByText, getByTestId, queryByTestId, queryByText } = await renderScreen();
      const tree = JSON.stringify(layoutOf(getByTestId('ledger-list')));

      expect(getByTestId('holding-detail-transactions-divider')).toBeTruthy();
      expect(tree.indexOf('holding-detail-transactions-divider')).toBeLessThan(
        tree.indexOf('"Transactions"'),
      );
      expect(getByText('Transactions')).toBeTruthy();
      expect(getByText('No transactions')).toBeTruthy();
      expect(queryByTestId('holding-detail-loan-payments-empty')).toBeNull();
      expect(queryByText('No payments yet')).toBeNull();
    });

    it('lists no linked payment and no scheduled payment for a non-loan holding, even if seeded', async () => {
      seed(propertyHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [], {}, [
        { ...linkedPayment, description: 'Unrelated' },
      ]);

      const { queryByText, queryByTestId } = await renderScreen();

      expect(queryByText('Unrelated')).toBeNull();
      expect(queryByTestId(/^scheduled-payment/)).toBeNull();
    });

    it.each([
      ['deposit', futureDepositHolding],
      ['bond', bondHolding],
    ])('leaves a %s ledger without any scheduled payment or toggle', async (_name, holding) => {
      seed(holding);

      const { getAllByTestId, queryByTestId, getByText } = await renderScreen();

      expect(getByText('Transactions')).toBeTruthy();
      expect(getAllByTestId('ledger-row').length).toBeGreaterThan(0);
      expect(queryByTestId(/^scheduled-payment/)).toBeNull();
      expect(queryByTestId('holding-detail-loan-payments-empty')).toBeNull();
    });
  });

  it('tapping a linked-payment row opens the transaction form for that row', async () => {
    seed(
      shortLoanHolding,
      [],
      [],
      [{ id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' }],
      [],
      [{ baseCurrency: 'UAH' }],
      undefined,
      [],
      {},
      [
        {
          id: 'txn-linked',
          holdingId: 'payer-1',
          amountMinorUnits: -100_000,
          time: 1_000,
          description: 'First installment',
          source: 'manual',
          loanHoldingId: 'h-1',
          loanLinkSource: 'manual',
        },
      ],
    );

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('First installment'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', {
      transactionId: 'txn-linked',
    });
  });

  it('hides the footer add action for a synced Monobank holding', async () => {
    // A synced holding's ledger is owned by the Monobank sync, so the detail
    // screen offers no manual add action. The gate needs BOTH the connected
    // `monobank` account AND the `monobankId` sync key in metadata.
    seed(
      {
        ...cardHolding,
        accountId: 'acc-1',
        metadata: { monobankId: 'mono-1' },
      },
      [],
      [],
      [],
      [],
      [{ baseCurrency: 'UAH' }],
      { id: 'acc-1', institution: 'monobank' },
    );

    const { queryByTestId, queryByText } = await renderScreen();

    expect(queryByTestId('screen-footer')).toBeNull();
    expect(queryByText('Add transaction')).toBeNull();
  });

  it('groups the ledger by day with Today/Yesterday separators, newest day first', async () => {
    const now = Date.now();
    // Ordered newest-first, matching the repo query's own `desc(time)` order.
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: now, description: 'TodayTxn', source: 'manual' },
      {
        id: 'x2',
        amountMinorUnits: -5000,
        time: localDaysFrom(now, -1),
        description: 'YesterdayTxn',
        source: 'manual',
      },
    ]);

    const { getByText, getAllByText } = await renderScreen();

    expect(getByText('Today')).toBeTruthy();
    expect(getByText('Yesterday')).toBeTruthy();

    // getAllByText returns matches in tree order, so the rendered order of the
    // separators and their rows proves the newest day (and its row) comes
    // first — the same grouping shape and assertion style Home's own
    // day-grouping test uses.
    const rendered = getAllByText(/^(Today|TodayTxn|Yesterday|YesterdayTxn)$/).map(
      (node) => node.props.children,
    );
    expect(rendered).toEqual(['Today', 'TodayTxn', 'Yesterday', 'YesterdayTxn']);
  });

  it('collapses same-day transactions under a single day header', async () => {
    const now = Date.now();
    seed(cardHolding, [
      {
        id: 'x1',
        amountMinorUnits: -5000,
        time: now,
        description: 'FirstToday',
        source: 'manual',
      },
      {
        id: 'x2',
        amountMinorUnits: -3000,
        // Local midnight stays on today at any hour; a fixed minute back from
        // `now` falls on yesterday when the suite runs just after midnight.
        time: startOfLocalDay(now),
        description: 'SecondToday',
        source: 'manual',
      },
    ]);

    const { getAllByTestId, getByText } = await renderScreen();

    // Both same-day rows render...
    expect(getByText('FirstToday')).toBeTruthy();
    expect(getByText('SecondToday')).toBeTruthy();
    // ...but only ONE day header is emitted for the whole ledger, proving the
    // second row did not open its own section.
    expect(getAllByTestId('ledger-day-header')).toHaveLength(1);
  });

  it('renders an explicit DD.MM.YYYY date separator for an older day (not Today/Yesterday)', async () => {
    const older = localDaysFrom(Date.now(), -5);
    const expectedHeader = formatDate(older);
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: older, description: 'OldTxn', source: 'manual' },
    ]);

    const { getByText, queryByText } = await renderScreen();

    expect(getByText(expectedHeader)).toBeTruthy();
    expect(queryByText('Today')).toBeNull();
    expect(queryByText('Yesterday')).toBeNull();
  });

  it('keeps the footer add action for a disconnected former-Monobank holding', async () => {
    // `isSyncedHolding` requires a CONNECTED account: disconnect keeps the
    // `monobankId` key on the holding, but the account's `institution` is null,
    // so the holding counts as manual again and keeps its add action.
    seed(
      {
        ...cardHolding,
        accountId: 'acc-1',
        metadata: { monobankId: 'mono-1' },
      },
      [],
      [],
      [],
      [],
      [{ baseCurrency: 'UAH' }],
      { id: 'acc-1', institution: null },
    );

    const { getByTestId } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add transaction')).toBeTruthy();
  });
});

describe('HoldingDetailScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading spinner, not the empty-transactions text, while any of its own queries is on its first load', async () => {
    seed(cashHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [], {
      holdings: true,
    });

    const { getByTestId, queryByText, queryByTestId } = await renderScreen();

    // The FlatList itself stays MOUNTED throughout — bleedTop +
    // contentInsetAdjustmentBehavior must apply from the very first render —
    // showing the shared LoadingState as its header/empty content instead of
    // a separate Screen branch.
    expect(getByTestId('holding-detail-loading')).toBeTruthy();
    expect(getByTestId('ledger-list')).toBeTruthy();
    expect(queryByText(i18n.t('holdingDetail.emptyTransactions'))).toBeNull();
    expect(queryByTestId('screen-footer')).toBeNull();
  });

  it('renders the real ledger once every query has loaded', async () => {
    seed(cashHolding);

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('ledger-list')).toBeTruthy();
    expect(queryByTestId('holding-detail-loading')).toBeNull();
  });
});

describe('HoldingDetailScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the Value breakdown labels, Transactions heading, and footer action from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    seed(depositHolding);
    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Вартість')).toBeTruthy();
    expect(getByText('Валова вартість')).toBeTruthy();
    expect(getByText('Отримані відсотки')).toBeTruthy();
    expect(getByText('Утримано податку')).toBeTruthy();
    expect(getByText('Транзакції')).toBeTruthy();
    expect(queryByText('Value')).toBeNull();
    expect(queryByText('Transactions')).toBeNull();
  });

  describe('a loan with no payments', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    it('renders the Transactions heading and its empty state from the Ukrainian catalog', async () => {
      seed(noneLoanHolding);
      const { getByText, queryByText } = await renderScreen();

      expect(getByText('Транзакції')).toBeTruthy();
      expect(getByText('Платежів ще немає')).toBeTruthy();
      expect(getByText('Тут зʼявляться повʼязані та заплановані платежі.')).toBeTruthy();
      expect(queryByText('No payments yet')).toBeNull();
    });
  });

  describe('a loan with a linked payment', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    it('reads the payment split and the balance left from the Ukrainian catalog', async () => {
      const [first] = loanInstallments(shortLoanMeta);

      seed(
        shortLoanHolding,
        [],
        [],
        [{ id: 'payer-1', name: 'Everyday card', type: 'card', currency: 'UAH' }],
        [],
        [{ baseCurrency: 'UAH' }],
        undefined,
        [],
        {},
        [
          {
            id: 'txn-first',
            holdingId: 'payer-1',
            amountMinorUnits: -first.paymentMinorUnits,
            currency: 'UAH',
            time: first.dueDate,
            description: 'First installment',
            source: 'manual',
            loanHoldingId: 'h-1',
            loanLinkSource: 'manual',
          },
        ],
      );

      const { getAllByTestId } = await renderScreen();
      const [card] = getAllByTestId('ledger-row');

      expect(within(card).getByText(/^Основна сума .* · відсотки /)).toBeTruthy();
      expect(within(card).getByText(/^Залишок /)).toBeTruthy();
      expect(within(card).queryByText(/^Principal /)).toBeNull();
      expect(within(card).queryByText(/^Remaining /)).toBeNull();
    });
  });

  describe('a loan with a long schedule', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    it('titles a scheduled payment and labels the toggle from the Ukrainian catalog', async () => {
      seed(annuityLoanHolding);
      const { getAllByText, getByTestId, queryByText } = await renderScreen();

      expect(getAllByText('Платіж за кредитом').length).toBeGreaterThan(0);
      expect(getAllByText('Заплановано').length).toBeGreaterThan(0);
      expect(
        within(getByTestId('scheduled-payments-toggle')).getByText('Показати всі'),
      ).toBeTruthy();
      expect(queryByText('Loan payment')).toBeNull();
      expect(queryByText('Scheduled')).toBeNull();
    });
  });

  describe('the derived rows under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    const expectSubtitle = (cards: TextNode[], title: string, subtitle: string) => {
      const titled = cardsTitled(cards, title);

      expect(titled.length).toBeGreaterThan(0);

      for (const card of titled) {
        expect(within(card).getByText(subtitle)).toBeTruthy();
      }
    };

    it('puts Прогноз under a future deposit row', async () => {
      seed(futureDepositHolding);
      const { getAllByTestId, queryByText } = await renderScreen();

      expectSubtitle(getAllByTestId('ledger-row'), 'Нарахування відсотків', 'Прогноз');
      expect(queryByText('Нарахування відсотків · Прогноз')).toBeNull();
    });

    it('puts Обчислено under a past deposit row', async () => {
      seed(depositHolding);
      const { getAllByTestId } = await renderScreen();

      expectSubtitle(getAllByTestId('ledger-row'), 'Відкриття депозиту', 'Обчислено');
      expectSubtitle(getAllByTestId('ledger-row'), 'Нарахування відсотків', 'Обчислено');
    });

    it('puts Обчислено under a paid bond coupon', async () => {
      seed(bondHolding);
      const { getAllByTestId } = await renderScreen();
      const paidCoupons = cardsTitled(
        cardsTitled(getAllByTestId('ledger-row'), 'Купон'),
        'Обчислено',
      );

      expect(paidCoupons.length).toBeGreaterThan(0);
    });

    it('puts Прогноз under a bond coupon still ahead', async () => {
      const now = new Date();

      seed({
        ...bondHolding,
        metadata: {
          ...bondHolding.metadata,
          purchaseDate: now.getTime(),
          maturityDate: new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()).getTime(),
        },
      });
      const { getAllByTestId } = await renderScreen();

      expectSubtitle(getAllByTestId('ledger-row'), 'Купон', 'Прогноз');
    });

    it('puts nothing under a past metal lot', async () => {
      seed(metalHolding);
      const { getAllByTestId, queryByText } = await renderScreen();

      expect(cardsTitled(getAllByTestId('ledger-row'), 'Купівля').length).toBeGreaterThan(0);
      expect(queryByText(/Прогноз|Обчислено|Заплановано/)).toBeNull();
    });

    it('puts Прогноз under a future metal lot', async () => {
      seed({
        ...metalHolding,
        metadata: {
          ...metalHolding.metadata,
          lots: [
            {
              day: Date.UTC(new Date().getUTCFullYear() + 1, 0, 1),
              quantityDelta: '10',
              costMinorUnits: 5_000_000,
            },
          ],
        },
      });
      const { getAllByTestId } = await renderScreen();

      expectSubtitle(getAllByTestId('ledger-row'), 'Купівля', 'Прогноз');
    });
  });

  it('renders the priced breakdown labels from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    seed(propertyHolding);
    const { getAllByText, getByText, queryByText } = await renderScreen();

    // "Вартість" also labels the headline amount above the breakdown; the
    // breakdown's own Cost row is one of its matches.
    expect(getAllByText('Вартість').length).toBeGreaterThanOrEqual(2);
    expect(getByText('Поточна вартість')).toBeTruthy();
    expect(getByText('Прибуток')).toBeTruthy();
    expect(queryByText('Cost')).toBeNull();
    expect(queryByText('Gain')).toBeNull();
  });

  it('renders the Add transaction footer action from the Ukrainian catalog for a non-deposit holding', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    seed(cardHolding);
    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Додати транзакцію')).toBeTruthy();
    expect(queryByText('Add transaction')).toBeNull();
  });
});

// kiko-architecture: no request or query for data the user does not have —
// usePriceBook's price_points read is disabled while the displayed holding
// never reads it.
describe('HoldingDetailScreen — the price_points gate', () => {
  it('disables the price_points read for a non-priced, non-loan holding', async () => {
    seed(cardHolding);
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(false);
  });

  it('enables the price_points read for a priced holding', async () => {
    seed(metalHolding);
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  it('reads price_points in parallel while holdings are still on their first load', async () => {
    seed(cardHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [], {
      holdings: true,
    });
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  // Only a loan reads its linked payments, so a priced holding's detail never
  // runs the linked-payments read.
  it('reads the linked loan payments only for a loan', async () => {
    const loanPaymentsCall = () =>
      mockUseLiveQuery.mock.calls.find((call) => call[1].join(',') === 'transactions,holdings');

    seed(metalHolding);
    await renderScreen();
    expect(loanPaymentsCall()?.[2]).toBe(false);

    mockUseLiveQuery.mockClear();
    seed(annuityLoanHolding);
    await renderScreen();
    expect(loanPaymentsCall()?.[2]).toBe(true);
  });
});

describe('HoldingDetailScreen — bond yield to maturity', () => {
  const localDay = (year: number, month: number, day: number): number =>
    new Date(year, month - 1, day).getTime();

  // 98 x UA4000239115 bought at 1,076.72 each on 2026-09-10 — the seller
  // shows 15.40%.
  const isinBondMeta = {
    quantity: 98,
    faceValueMinorUnits: 100_000,
    couponPct: 15.18,
    couponFrequency: 'semiannually',
    bondKind: 'government',
    purchaseDate: localDay(2026, 9, 10),
    purchasePriceMinorUnits: 10_551_856,
    maturityDate: localDay(2027, 9, 15),
    isin: 'UA4000239115',
  };
  const isinBondHolding = { ...bondHolding, metadata: isinBondMeta };
  const registerRow = {
    isin: 'UA4000239115',
    terms: {
      isin: 'UA4000239115',
      currency: 'UAH',
      faceValueMinorUnits: 100_000,
      couponPct: 15.18,
      maturityDate: localDay(2027, 9, 15),
      couponFrequency: 'semiannually',
      name: 'Середньострокові UA4000239115',
      payments: [
        { date: localDay(2026, 9, 16), kind: 'coupon', amount: '75.9' },
        { date: localDay(2027, 3, 17), kind: 'coupon', amount: '75.9' },
        { date: localDay(2027, 9, 15), kind: 'coupon', amount: '75.9' },
        { date: localDay(2027, 9, 15), kind: 'redemption', amount: '1000' },
      ],
    },
    fetchedAt: 1,
  };

  const registerCall = () =>
    mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'bond_register');

  beforeEach(() => {
    jest.clearAllMocks();
    mockBondRegisterRows = [];
  });

  it("shows the seller's 15.40% for an ISIN bond read from the register payments", async () => {
    mockBondRegisterRows = [registerRow];
    seed(isinBondHolding);

    const { getByText, getByTestId } = await renderScreen();

    expect(getByText('Yield to maturity')).toBeTruthy();
    expect(getByTestId('bond-yield-to-maturity')).toHaveTextContent('15.40%');
    expect(registerCall()?.[0].toSQL().params).toEqual(['UA4000239115']);
    expect(registerCall()?.[2]).toBe(true);
  });

  it('shows the same 15.40% for a Manual bond from its generated schedule', async () => {
    seed({ ...bondHolding, metadata: { ...isinBondMeta, isin: undefined } });

    const { getByTestId } = await renderScreen();

    expect(getByTestId('bond-yield-to-maturity')).toHaveTextContent('15.40%');
    expect(registerCall()?.[2]).toBe(false);
  });

  it('shows no yield for a bond stored without a price, keeping its expected profit', async () => {
    seed({ ...bondHolding, metadata: { ...isinBondMeta, purchasePriceMinorUnits: undefined } });

    const { getByText, queryByText } = await renderScreen();

    expect(queryByText('Yield to maturity')).toBeNull();
    expect(getByText('Expected profit')).toBeTruthy();
  });

  it('never reads the register for a holding that is not a bond', async () => {
    seed(depositHolding);
    await renderScreen();

    expect(registerCall()?.[2]).toBe(false);
  });

  describe('a step-up bond', () => {
    // 1,000 x XS2895055981 (1-dollar nominal) for 980.00, saved at 4.5%: the
    // register pays 0.0225 per bond up to 2027-02 and 0.03 from 2027-08.
    const coupon = (year: number, month: number, amount: string) => ({
      date: localDay(year, month, 1),
      kind: 'coupon',
      amount,
    });
    const stepUpPayments = [
      coupon(2027, 2, '0.0225'),
      coupon(2027, 8, '0.03'),
      coupon(2028, 2, '0.03'),
      coupon(2028, 8, '0.03'),
      coupon(2029, 2, '0.03'),
      { date: localDay(2029, 2, 1), kind: 'redemption', amount: '1' },
    ];
    const stepUpMetadata = {
      quantity: 1000,
      faceValueMinorUnits: 100,
      couponPct: 4.5,
      couponFrequency: 'semiannually',
      bondKind: 'government',
      purchaseDate: localDay(2026, 9, 26),
      purchasePriceMinorUnits: 98_000,
      maturityDate: localDay(2029, 2, 1),
      isin: 'XS2895055981',
    };

    const expectStepUpCoupons = async () => {
      const { getAllByText, getByText } = await renderScreen();
      const couponAmounts = getAllByText('Coupon').map(
        (label) => amountForLabel(label, /\$/).props.children,
      );

      expect(couponAmounts.map(String)).toEqual([
        expect.stringContaining('30.00'),
        expect.stringContaining('30.00'),
        expect.stringContaining('30.00'),
        expect.stringContaining('30.00'),
        expect.stringContaining('22.50'),
      ]);
      expect(amountForLabel(getByText('Expected profit'), /\$/)).toHaveTextContent(/162\.50/);
    };

    it("books its coupons and expected profit at each register payment's rate", async () => {
      mockBondRegisterRows = [
        {
          isin: 'XS2895055981',
          terms: {
            isin: 'XS2895055981',
            currency: 'USD',
            faceValueMinorUnits: 100,
            couponPct: 4.5,
            maturityDate: localDay(2029, 2, 1),
            couponFrequency: 'semiannually',
            name: 'OЗДП-середньострокова XS2895055981',
            payments: stepUpPayments,
          },
          fetchedAt: 1,
        },
      ];
      seed({ ...bondHolding, currency: 'USD', metadata: stepUpMetadata });

      await expectStepUpCoupons();
    });

    it('keeps the same coupons from its kept schedule once its ISIN has left the cache', async () => {
      seed({
        ...bondHolding,
        currency: 'USD',
        metadata: { ...stepUpMetadata, payments: stepUpPayments },
      });

      await expectStepUpCoupons();
    });
  });
});

const textLayout = (content: string): LayoutNode => ({ style: {}, children: [content] });

const descriptionLayout = (label: string, ...subtitles: string[]): LayoutNode => ({
  style: { flex: 1, marginRight: darkTheme.spacing(3) },
  children: [label, ...subtitles].map(textLayout),
});

const amountLayout = (testID: string, caption: LayoutNode[] = []): LayoutNode => ({
  style: { flexShrink: 0, alignItems: 'flex-end', gap: darkTheme.spacing(1) },
  children: [{ testID, children: [expect.any(String)] }, ...caption],
});

const mainRowLayout = (children: LayoutNode[]): LayoutNode => ({
  style: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  children,
});

const leadLayout = (children: LayoutNode[]): LayoutNode => ({
  style: { alignItems: 'flex-start', flex: 1, flexDirection: 'row', gap: darkTheme.spacing(2) },
  children,
});

const categoryIconLayout: LayoutNode = {
  style: { height: darkTheme.iconSizes.body, width: darkTheme.iconSizes.body },
  symbol: expect.any(String),
  tint: expect.any(String),
  children: [],
};

// The caption line under the amount: an optional leading icon, centred with the text.
const captionLayout = (caption: string, icon: LayoutNode[] = []): LayoutNode => ({
  style: { alignItems: 'center', flexDirection: 'row', gap: darkTheme.spacing(1) },
  children: [...icon, { style: {}, children: [caption] }],
});

const cardLayout = (children: LayoutNode[]): LayoutNode => ({
  style: expect.objectContaining({
    padding: darkTheme.spacing(3),
    borderRadius: darkTheme.radii.md,
  }),
  testID: 'ledger-row',
  children: [{ style: { gap: darkTheme.spacing(1) }, children }],
});

// Pins the approved look of the ledger rows and their day header, which the shared
// EntryCard / EntryDateHeader draw.
describe('HoldingDetailScreen — ledger row look', () => {
  it('draws a settled derived row as a card: marker under the label, amount right, no caption', async () => {
    seed(depositHolding);

    const { getAllByTestId } = await renderScreen();
    const [row] = cardsTitled(getAllByTestId('ledger-row'), 'Interest accrual');

    if (row === undefined) {
      throw new Error('fixture must carry a settled interest accrual row');
    }

    expect(layoutOf(row)).toEqual(
      cardLayout([
        mainRowLayout([
          descriptionLayout('Interest accrual', 'Computed'),
          amountLayout('money-tone-positive'),
        ]),
      ]),
    );
    expect(StyleSheet.flatten(row.props.style)).not.toHaveProperty('opacity');
  });

  it('dims a projected derived row to half opacity and puts Projected under its title', async () => {
    seed(futureDepositHolding);

    const { getAllByTestId } = await renderScreen();
    const [row] = cardsTitled(getAllByTestId('ledger-row'), 'Interest accrual');

    if (row === undefined) {
      throw new Error('fixture must carry a projected row');
    }

    expect(layoutOf(row)).toEqual(
      cardLayout([
        mainRowLayout([
          descriptionLayout('Interest accrual', 'Projected'),
          amountLayout('money-tone-positive'),
        ]),
      ]),
    );
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ opacity: 0.5 });
  });

  it('draws a stored transaction row with its category icon, loan-link marker, and time caption', async () => {
    seed(cardHolding, [
      {
        id: 'x1',
        amountMinorUnits: -5000,
        time: new Date(2024, 0, 15, 9, 5).getTime(),
        description: 'Loan payment',
        source: 'manual',
        loanHoldingId: 'loan-1',
      },
    ]);

    const { getAllByTestId } = await renderScreen();

    expect(layoutOf(getAllByTestId('ledger-row')[0])).toEqual(
      cardLayout([
        mainRowLayout([
          leadLayout([categoryIconLayout, descriptionLayout('Loan payment')]),
          amountLayout('money-tone-auto', [
            captionLayout('09:05', [
              {
                style: { height: darkTheme.iconSizes.caption, width: darkTheme.iconSizes.caption },
                symbol: 'link',
                // The native symbol takes the textSecondary token as 8-digit hex.
                tint: '#ebebf599',
                testID: 'ledger-row-loan-link-marker',
                children: [],
              },
            ]),
          ]),
        ]),
      ]),
    );
  });

  it('draws a stored transaction row without a footer or loan-link marker when it has neither', async () => {
    seed(depositHolding, [
      {
        id: 'x1',
        amountMinorUnits: 5000,
        time: new Date(2024, 5, 20, 9, 5).getTime(),
        description: 'Top-up',
        source: 'manual',
      },
    ]);

    const { getAllByTestId } = await renderScreen();
    const row = getAllByTestId('ledger-row').find(
      (candidate) => within(candidate).queryByText('Top-up') !== null,
    );

    if (row === undefined) {
      throw new Error('fixture must carry the stored row');
    }

    expect(layoutOf(row)).toEqual(
      cardLayout([
        mainRowLayout([
          leadLayout([categoryIconLayout, descriptionLayout('Top-up')]),
          amountLayout('money-tone-auto'),
        ]),
      ]),
    );
  });

  it('spaces the ledger cells by the spacing(2) content-container gap', async () => {
    seed(cardHolding);

    const { getByTestId } = await renderScreen();

    expect(StyleSheet.flatten(getByTestId('ledger-list').props.contentContainerStyle).gap).toBe(
      darkTheme.spacing(2),
    );
  });

  it('heads a day with a caption label glued above its first card', async () => {
    seed(cardHolding, [
      {
        id: 'x1',
        amountMinorUnits: -5000,
        time: new Date(2024, 0, 15, 9, 5).getTime(),
        description: 'Coffee',
        source: 'manual',
      },
    ]);

    const { getByTestId } = await renderScreen();

    expect(layoutOf(getByTestId('ledger-day-header'))).toEqual({
      style: { paddingTop: darkTheme.spacing(3), paddingBottom: darkTheme.spacing(1) },
      testID: 'ledger-day-header',
      children: [textLayout(formatDate(new Date(2024, 0, 15, 9, 5).getTime()))],
    });
  });
});

describe('HoldingDetailScreen with a title that does not fit the native large title', () => {
  const HEADER_HEIGHT = 100;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The context a navigator layout sets while the title is too long for one line of the native
  // large title: the list header then starts with the full title.
  const renderWithHeading = (onScrolledChange: jest.Mock) =>
    render(
      <HeaderHeightContext.Provider value={HEADER_HEIGHT}>
        <LargeTitleHeadingContext.Provider
          value={{
            title: 'A holding with a very long name',
            scrolled: false,
            headingBottom: { current: 150 },
            onScrolledChange,
            onHostedChange: jest.fn(),
          }}
        >
          <HoldingDetailScreen
            navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
            route={route}
          />
        </LargeTitleHeadingContext.Provider>
      </HeaderHeightContext.Provider>,
      { wrapper: GestureRootWrapper },
    );

  it('starts the ledger list header with the heading', async () => {
    seed(cashHolding);

    const { getByTestId, getByText } = await renderWithHeading(jest.fn());
    const headerBlocks = within(getByTestId('ledger-list')).getAllByTestId(
      /^(large-title-heading|holding-value-header)$/,
    );

    expect(getByText('A holding with a very long name')).toBeTruthy();
    expect(headerBlocks.map((block) => block.props.testID)).toEqual([
      'large-title-heading',
      'holding-value-header',
    ]);
  });

  it('reports the heading scrolled under the bar from the ledger list', async () => {
    seed(cashHolding);
    const onScrolledChange = jest.fn();

    const { getByTestId } = await renderWithHeading(onScrolledChange);
    const list = getByTestId('ledger-list');

    await fireEvent.scroll(list, {
      nativeEvent: {
        contentOffset: { x: 0, y: 50 },
        layoutMeasurement: { width: 393, height: 800 },
        contentSize: { width: 393, height: 2000 },
      },
    });

    expect(onScrolledChange).toHaveBeenCalledWith(true);
  });

  // The heading bar is translucent: the list rests one header height above offset zero.
  it('does not report the heading scrolled at the rest offset under the translucent bar', async () => {
    seed(cashHolding);
    const onScrolledChange = jest.fn();

    const { getByTestId } = await renderWithHeading(onScrolledChange);

    await fireEvent.scroll(getByTestId('ledger-list'), {
      nativeEvent: {
        contentOffset: { x: 0, y: -HEADER_HEIGHT },
        layoutMeasurement: { width: 393, height: 800 },
        contentSize: { width: 393, height: 2000 },
      },
    });

    expect(onScrolledChange).not.toHaveBeenCalledWith(true);
  });

  it('shows no heading while the native large title shows the title', async () => {
    seed(cashHolding);

    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('large-title-heading')).toBeNull();
  });
});
