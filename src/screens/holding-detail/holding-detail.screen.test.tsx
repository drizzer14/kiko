import { Alert } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { transactionsRepo } from '../../repositories/transactions.repo';
import HoldingDetailScreen from './holding-detail.screen';

// The Text primitive's tone -> color mapping lives inside a unistyles variant
// that the project Jest mock strips before a test can inspect it, so a money
// amount's resolved color is not observable. Mock MoneyText to expose the
// `tone` prop it is handed via a testID instead, while still rendering the
// formatted amount underneath (so the trailing ₴ that `amountForLabel` scans
// for is present). The ledger's derived rows and the interest/tax breakdown
// lines pass an explicit tone, which is exactly what these tests assert.
jest.mock('../../design-system/components/money-text', () => {
  const { Text: RNText } = require('react-native');
  const { formatMoney } = require('../../currency/format');

  return {
    __esModule: true,
    default: ({ money, tone }: { money: Parameters<typeof formatMoney>[0]; tone?: string }) => (
      <RNText testID={`money-tone-${tone ?? 'auto'}`}>{formatMoney(money)}</RNText>
    ),
  };
});

// The test-renderer instance type, derived from RNTL's own query rather than
// imported from react-test-renderer directly (which is not a declared dep).
type TextNode = ReturnType<ReturnType<typeof render>['getByText']>;

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

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    appendDepositContribution: jest.fn(),
    updateName: jest.fn(),
    setIcon: jest.fn(),
    setColor: jest.fn(),
  },
}));
jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: {
    listByHoldingQuery: (holdingId: string) => ({
      toSQL: () => ({ sql: '', params: [holdingId] }),
    }),
    remove: jest.fn(),
  },
}));
jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;
const route = { params: { holdingId: 'h-1' } } as never;

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
const seed = (holding: unknown, transactions: unknown[] = [], categories: unknown[] = []): void => {
  mockUseLiveQuery.mockImplementation((_query: unknown, keys: string[]) => {
    if (keys[0] === 'holdings') {
      return { data: [holding] };
    }

    if (keys[0] === 'categories') {
      return { data: categories };
    }

    return { data: transactions };
  });
};

const renderScreen = () => render(<HoldingDetailScreen navigation={navigation} route={route} />);

describe('HoldingDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets the header title to the holding name', async () => {
    seed(cashHolding);

    await renderScreen();

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'My deposit' });
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    seed(cashHolding);

    const { getByTestId, getByText } = await renderScreen();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The name drives the dynamic header title AND renders in the view-only
    // identity header beside the icon (identity editing moved to the edit form).
    expect(getByText('My deposit')).toBeTruthy();
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

  it('tints the header icon with the holding stored color', async () => {
    seed({ ...cardHolding, color: darkTheme.colors.entityColors.violet });

    const { getByLabelText } = await renderScreen();

    // The card holding shows the creditcard glyph (no custom icon), tinted violet.
    expect(getByLabelText('Icon creditcard').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it('tints the header icon with the type default color when no color is stored', async () => {
    seed(cardHolding);

    const { getByLabelText } = await renderScreen();

    // A `card` holding with no color reads the card type default (white).
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
    expect(getAllByText(/^Projected ·/).length).toBeGreaterThan(0);
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

  it('pins the Add transaction action to the screen footer', async () => {
    seed(cardHolding);

    const { getByTestId } = await renderScreen();

    // The action sits in the Screen footer slot so it stays pinned to the bottom
    // on a short page rather than floating beneath the (possibly empty) ledger.
    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add transaction')).toBeTruthy();
  });

  it('renders the resolved category icon on a transaction row', async () => {
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
      [{ key: 'food', title: 'Food', icon: 'fork.knife' }],
    );

    const { getByLabelText } = await renderScreen();

    // The row resolves its stored `category` through the same shared mapping
    // Home uses, so the icon follows the categories table (here `fork.knife`).
    expect(getByLabelText('Food').props.name).toBe('fork.knife');
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

  it('deletes a manual transaction via the swipe action', async () => {
    seed(cardHolding, [
      { id: 'txn-9', amountMinorUnits: -5000, time: 1, description: 'Coffee', source: 'manual' },
    ]);

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = (buttons ?? []).find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getByLabelText } = await renderScreen();

    // The delete action is a11y-hidden on a closed row, so it must be queried
    // with hidden elements included.
    await fireEvent.press(getByLabelText('Delete', { includeHiddenElements: true }));

    expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-9');
    alertSpy.mockRestore();
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

    const { queryByLabelText } = await renderScreen();

    expect(queryByLabelText('Delete', { includeHiddenElements: true })).toBeNull();
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
    // Every settled derived row carries a "Computed" marker so it reads as derived.
    expect(getAllByText(/^Computed ·/).length).toBeGreaterThanOrEqual(3);
  });

  it('renders derived rows read-only: no swipe-delete and not tappable to the form', async () => {
    seed(depositHolding);

    const { getByText, queryByLabelText } = await renderScreen();

    // A derived-only deposit (no real transactions) offers no delete action at all.
    expect(queryByLabelText('Delete', { includeHiddenElements: true })).toBeNull();
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

    const { getByText, getByLabelText } = await renderScreen();

    // Both the real transaction and the derived opening deposit render together.
    expect(getByText('Fee')).toBeTruthy();
    expect(getByText('Opening deposit')).toBeTruthy();
    // Only the real row is deletable; the derived rows expose no delete action.
    expect(getByLabelText('Delete', { includeHiddenElements: true })).toBeTruthy();
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
});
