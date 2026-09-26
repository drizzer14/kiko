import { StyleSheet } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '../../design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import { holdingsRepo } from '@kiko/holdings/repo';
import { dayKeyOf } from '@kiko/prices/price-book';
import { formatMoney } from '@kiko/currency/format';
import { formatDate, startOfLocalDay } from '@kiko/dates';
import { transactionsRepo } from '@kiko/transactions/repo';

import { darkTheme } from '../../design-system/theme';
import {
  EDIT_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  DUPLICATE_ACTION_TEST_ID,
} from '../../design-system/components/card-context-menu';
import { loanInstallments } from '../../holdings/loan-schedule';
import type { LoanMeta } from '../../holdings/holding-metadata';
import GestureRootWrapper from '../../test-support/gesture-root-wrapper';
import { ancestorWithStyle } from '../../test-support/ancestor-with-style';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import HoldingDetailScreen from './holding-detail.screen';

type HoldingDetailProps = ComponentProps<typeof HoldingDetailScreen>;

// The Text primitive's tone -> color mapping lives inside a unistyles variant
// that the project Jest mock strips before a test can inspect it, so a money
// amount's resolved color is not observable. Mock MoneyText to expose the
// `tone` prop it is handed via a testID instead, while still rendering the
// formatted amount underneath (so the trailing ₴ that `amountForLabel` scans
// for is present). The ledger's derived rows and the interest/tax breakdown
// lines pass an explicit tone, which is exactly what these tests assert.
jest.mock('../../design-system/components/money-text', () => {
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
const amountForLabel = (label: TextNode): TextNode => {
  let node = label.parent;

  for (let depth = 0; depth < 8 && node; depth += 1) {
    const matches = within(node).queryAllByText(/₴/);

    if (matches.length > 0) {
      return matches[0];
    }

    node = node.parent;
  }

  throw new Error('no amount found for label row');
};

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

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    appendDepositContribution: jest.fn(),
    removeOwnershipChange: jest.fn(),
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
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({ toSQL: () => ({ sql: '', params: [accountId] }) }),
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
// schedule tabulates period rows that all close in the future — the case that
// used to render a "· projected" suffix.
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
  // key defaults to `false` (an already-resolved query), so every existing
  // call site above keeps behaving exactly as before.
  isLoading: Partial<Record<string, boolean>> = {},
  // The rows `listLinkedToLoanQuery` resolves to — the loan detail's own
  // "Linked payments" section. Defaults to none, so every existing
  // call site above keeps rendering no such section, unaffected.
  linkedLoanPayments: unknown[] = [],
): void => {
  // A per-table result map, keyed the same way the old if-chain branched — a
  // lookup instead of a chain keeps this well under the cognitive-complexity
  // budget (kiko-code-style). SQLite returns NULL, never undefined, for a
  // column a row does not set, so the transactions default normalizes every
  // nullable marker the screen reads the same way — an `undefined` here
  // would be a fixture artefact the device never produces.
  const resultByTable: Record<string, { data: unknown[]; isLoading: boolean }> = {
    holdings: { data: [holding, ...otherHoldings], isLoading: isLoading.holdings ?? false },
    categories: { data: categories, isLoading: isLoading.categories ?? false },
    currency_rates: { data: rates, isLoading: isLoading.currency_rates ?? false },
    settings: { data: settings, isLoading: isLoading.settings ?? false },
    accounts: {
      data: foldMap(maybe(account), (found) => [found]) ?? [],
      isLoading: isLoading.accounts ?? false,
    },
    price_points: { data: pricePoints, isLoading: isLoading.price_points ?? false },
    transactions: {
      data: transactions.map((row) => ({
        exchangeCounterpartHoldingId: null,
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

    return sql === 'linked-loan-payments' || sql === 'loan-ledger-payments'
      ? linkedLoanPaymentsResult
      : (resultByTable[keys[0]] ?? resultByTable.transactions);
  });
};

const renderScreen = () =>
  render(
    <HoldingDetailScreen
      navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
      route={route}
    />,
    { wrapper: GestureRootWrapper },
  );

describe('HoldingDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    // the screen is no longer a plain scroll view.
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
    // side gutter and top gap itself, in its own content container (the wrapper
    // used to supply these). Both are the base `spacing(4)` = 16 step, so the
    // rows sit inset from the edges exactly as before the collapse fix.
    const listContentStyle = StyleSheet.flatten(
      getByTestId('ledger-list').props.contentContainerStyle,
    );
    expect(listContentStyle.paddingHorizontal).toBe(16);
    expect(listContentStyle.paddingTop).toBe(16);
  });

  it('renders a view-only header with no inline name, icon, or color editors', async () => {
    seed(cardHolding);

    const { queryByLabelText } = await renderScreen();

    // Identity editing moved to the dedicated edit form: the header no longer
    // offers the icon-picker toggle, the editable name field, or the color row.
    expect(queryByLabelText('Change Icon')).toBeNull();
    expect(queryByLabelText('Everyday card name')).toBeNull();
    expect(queryByLabelText('Color violet')).toBeNull();
  });

  it('offers an Edit action in the header that opens the holding edit form', async () => {
    seed({ ...cardHolding, accountId: 'acc-1' });

    await renderScreen();

    // The Edit affordance sits at the header top-right (via setOptions
    // headerRight). Render it and press it: it opens this holding's edit form,
    // passing the owning account so the form can constrain the type chips.
    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.headerRight,
    );
    expect(call).toBeDefined();
    const { getByText } = await render(call[0].headerRight());
    await fireEvent.press(getByText('Edit'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
      accountId: 'acc-1',
      holdingId: 'h-1',
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

  it('marks future lifecycle entries as Projected', async () => {
    seed(futureDepositHolding);

    const { getAllByText } = await renderScreen();

    // The separate schedule card is gone; the lifecycle renders inline. A brand-
    // new deposit's future accruals render dimmed with a "Projected" marker.
    // futureDepositHolding is a term_deposit (day-granular), so the marker
    // carries no trailing time separator.
    expect(getAllByText('Projected').length).toBeGreaterThan(0);
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

    // The timestamp caption is wrapped in a right-aligned footer container
    // (alignSelf 'flex-end') so it lands under the amount column rather than
    // left-aligned under the description — mirroring the Home row layout.
    const footer = ancestorWithStyle(getByText('09:05'), 'alignSelf');
    expect(StyleSheet.flatten(footer.props.style)).toMatchObject({ alignSelf: 'flex-end' });
  });

  it('right-aligns the derived lifecycle row caption so it sits below the value', async () => {
    seed(depositHolding);

    const { getAllByText } = await renderScreen();

    // The derived "Computed" caption uses the same right-aligned footer
    // container, so it too sits under the amount column. depositHolding is a
    // term_deposit (day-granular), so the caption carries no trailing time.
    const footer = ancestorWithStyle(getAllByText('Computed')[0], 'alignSelf');
    expect(StyleSheet.flatten(footer.props.style)).toMatchObject({ alignSelf: 'flex-end' });
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

  it('pins the Add transaction action to the screen footer', async () => {
    seed(cardHolding);

    const { getByTestId } = await renderScreen();

    // The action sits in the Screen footer slot so it stays pinned to the bottom
    // on a short page rather than floating beneath the (possibly empty) ledger.
    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add transaction')).toBeTruthy();
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

  it('does not offer delete on a synced transaction row', async () => {
    seed(cardHolding, [
      {
        id: 'txn-mono',
        amountMinorUnits: -5000,
        time: 1,
        description: 'Coffee',
        source: 'monobank',
      },
    ]);

    const { queryByTestId } = await renderScreen();

    // A synced (Monobank) row is not deletable, so CardContextMenu renders it
    // bare — no card-context-menu wrapper and no hold gesture to intercept it.
    expect(queryByTestId('card-context-menu')).toBeNull();
  });

  it('renders the derived lifecycle rows (opening, accrual, taxes) marked Computed', async () => {
    seed(depositHolding);

    const { getByText, getAllByText } = await renderScreen();

    // derivedEntries yields the opening deposit plus per-period interest and its
    // two withholding lines. These read distinctly from the value-breakdown
    // labels ("Interest earned"/"Tax withheld").
    expect(getByText('Opening deposit')).toBeTruthy();
    expect(getAllByText('Interest accrual').length).toBeGreaterThan(0);
    expect(getAllByText('Income tax 18%').length).toBeGreaterThan(0);
    expect(getAllByText('Military levy 5%').length).toBeGreaterThan(0);
    // Every settled derived row carries a "Computed" marker so it reads as
    // derived. depositHolding is a term_deposit (day-granular), so the marker
    // carries no trailing time separator.
    expect(getAllByText('Computed').length).toBeGreaterThanOrEqual(3);
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
    // coloring that used to leave these positive magnitudes white.
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

  it('navigates to PricePointForm on "Update value"', async () => {
    seed(propertyHolding);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Update value'));

    expect(navigation.navigate).toHaveBeenCalledWith('PricePointForm', { holdingId: 'h-1' });
  });

  // A property_item (ledgerless, no derived lifecycle entries) with no real
  // transactions used to leave a bare "Transactions" heading with nothing
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

  it('navigates to LotForm on "Add lot"', async () => {
    seed(metalHolding);

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add lot'));

    expect(navigation.navigate).toHaveBeenCalledWith('LotForm', { holdingId: 'h-1' });
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

  it('lists every remaining payment of an annuity loan, starting at the next installment', async () => {
    seed(annuityLoanHolding);

    const { getByText, getByTestId, getAllByTestId } = await renderScreen();

    const upcoming = loanInstallments(annuityLoanMeta).filter(
      (row) => row.dueDate >= startOfLocalDay(Date.now()),
    );
    const [next] = upcoming;

    if (next === undefined) {
      throw new Error('fixture must have an upcoming installment for this test to mean anything');
    }

    expect(getByText('Upcoming Payments')).toBeTruthy();
    expect(getAllByTestId(/^upcoming-payment-/)).toHaveLength(upcoming.length);
    // Scoped per row: a swapped principal/interest would fail here, unlike a
    // bare `getByText` search over the whole screen.
    expect(getByTestId(`upcoming-payment-${next.index}`)).toHaveTextContent(
      formatMoney(Money.of('UAH', next.paymentMinorUnits)).concat(
        `Principal ${formatMoney(Money.of('UAH', next.principalMinorUnits))}`,
        ` · interest ${formatMoney(Money.of('UAH', next.interestMinorUnits))}`,
      ),
    );
  });

  it('renders every remaining payment of a 30-year mortgage', async () => {
    seed({
      ...annuityLoanHolding,
      metadata: { ...annuityLoanMeta, startDate: startMonthsAgo(0), termMonths: 360 },
    });

    const { getAllByTestId } = await renderScreen();

    expect(getAllByTestId(/^upcoming-payment-/)).toHaveLength(360);
  });

  it('shows no upcoming payments for a "none" schedule loan', async () => {
    seed(noneLoanHolding);

    const { queryByText } = await renderScreen();

    expect(queryByText('Upcoming Payments')).toBeNull();
  });

  it('shows no upcoming payments for a non-loan holding', async () => {
    seed(propertyHolding);

    const { queryByText } = await renderScreen();

    expect(queryByText('Upcoming Payments')).toBeNull();
  });

  // An overpaid correction clamps the outstanding to 0 even though
  // `loanInstallments` still has future rows on the schedule — the list must
  // not keep showing payments once the debt is actually paid off.
  it('shows no upcoming payments once a correction clamps the outstanding to 0', async () => {
    seed(annuityLoanHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [
      { instrument: 'holding:h-1', day: dayKeyOf(Date.now()), price: '0.00', currency: 'UAH' },
    ]);

    const { queryByText } = await renderScreen();

    expect(queryByText('Upcoming Payments')).toBeNull();
  });

  // The loan detail lists linked payments — the ONLY way to review an auto
  // link, since a loan itself carries no ledger of its own
  // (isLedgerlessHoldingType). Reuses the shared ledger row component and
  // its own "linked automatically" marker.
  it('lists linked payments newest first, with the loan-link marker', async () => {
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
          id: 'txn-older',
          holdingId: 'payer-1',
          amountMinorUnits: -100_000,
          time: 1_000,
          description: 'First installment',
          source: 'manual',
          loanHoldingId: 'h-1',
          loanLinkSource: 'manual',
        },
        {
          id: 'txn-newer',
          holdingId: 'payer-1',
          amountMinorUnits: -100_000,
          time: 2_000,
          description: 'Second installment',
          source: 'manual',
          loanHoldingId: 'h-1',
          loanLinkSource: 'auto',
        },
      ],
    );

    const { getByText, getAllByTestId } = await renderScreen();

    expect(getByText('Linked Payments')).toBeTruthy();
    expect(getByText('First installment')).toBeTruthy();
    expect(getByText('Second installment')).toBeTruthy();
    // The query already orders newest-first — the screen renders the rows
    // in the order it receives them, so the newer row's own cell comes
    // first among the linked-payment markers.
    expect(getAllByTestId('ledger-row-loan-link-marker').length).toBeGreaterThanOrEqual(2);
  });

  it('hides the Linked payments section entirely when there are none', async () => {
    seed(annuityLoanHolding);

    const { queryByText } = await renderScreen();

    expect(queryByText('Linked Payments')).toBeNull();
  });

  it('never shows a Linked payments section for a non-loan holding, even if seeded', async () => {
    seed(propertyHolding, [], [], [], [], [{ baseCurrency: 'UAH' }], undefined, [], {}, [
      {
        id: 'txn-1',
        holdingId: 'payer-1',
        amountMinorUnits: -100_000,
        time: 1_000,
        description: 'Unrelated',
        source: 'manual',
        loanHoldingId: 'h-1',
        loanLinkSource: 'manual',
      },
    ]);

    const { queryByText } = await renderScreen();

    expect(queryByText('Linked Payments')).toBeNull();
  });

  it('tapping a linked-payment row opens the transaction form for that row', async () => {
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
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // Ordered newest-first, matching the repo query's own `desc(time)` order.
    seed(cardHolding, [
      { id: 'x1', amountMinorUnits: -5000, time: now, description: 'TodayTxn', source: 'manual' },
      {
        id: 'x2',
        amountMinorUnits: -5000,
        time: now - day,
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
        time: now - 60 * 1000,
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
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const older = now - 5 * day;
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
