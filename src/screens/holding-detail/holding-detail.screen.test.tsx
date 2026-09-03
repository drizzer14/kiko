import { Alert } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import HoldingDetailScreen from './holding-detail.screen';

// The test-renderer instance type, derived from RNTL's own query rather than
// imported from react-test-renderer directly (which is not a declared dep).
type TextNode = ReturnType<ReturnType<typeof render>['getByText']>;

// Flatten a Text node's style array down to its resolved inline `color` (the
// LedgerAmount tone color; unistyles variant styles are stripped by the mock,
// but an inline color survives). Used to assert a ledger row's money tone.
const colorOf = (node: TextNode): unknown => {
  const style = node.props.style as unknown;
  const parts = (Array.isArray(style) ? style : [style]).flat(Number.POSITIVE_INFINITY);
  return Object.assign({}, ...parts.filter(Boolean)).color;
};

// The tightest ancestor of `label` that contains a money amount (UAH formats
// with a trailing ₴), scoped to a single ledger/breakdown row — its amount Text
// is what carries the tone color.
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

// Seeds a deposit, renders, and opens the add-contribution form so a test can
// go straight to filling and submitting it.
const openContributionForm = async () => {
  seed(depositHolding);
  const utils = await renderScreen();
  await fireEvent.press(utils.getByText('Add contribution'));
  return utils;
};

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

    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The header large title is still the single heading title; the metadata
    // header's name field holds the name as an input value (not a host Text), so
    // queryByText finds no in-body heading duplicate.
    expect(queryByText('My deposit')).toBeNull();
  });

  it('edits the holding name in a header field and renames via holdingsRepo.updateName on end-of-editing', async () => {
    seed(cardHolding);

    const { getByLabelText } = await renderScreen();

    // The name is edited on this page now (relocated from the account-detail
    // list row): a labelled field committed once on end-of-editing.
    const input = getByLabelText('Everyday card name');
    await fireEvent.changeText(input, 'Renamed card');
    await fireEvent(input, 'endEditing');

    expect(holdingsRepo.updateName).toHaveBeenCalledWith('h-1', 'Renamed card');
  });

  it('does not save an empty holding name', async () => {
    seed(cardHolding);

    const { getByLabelText } = await renderScreen();

    const input = getByLabelText('Everyday card name');
    await fireEvent.changeText(input, '   ');
    await fireEvent(input, 'endEditing');

    expect(holdingsRepo.updateName).not.toHaveBeenCalled();
  });

  it('does not save an unchanged holding name', async () => {
    seed(cardHolding);

    const { getByLabelText } = await renderScreen();

    const input = getByLabelText('Everyday card name');
    await fireEvent(input, 'endEditing');

    expect(holdingsRepo.updateName).not.toHaveBeenCalled();
  });

  it('changes the holding icon through the header icon editor, via holdingsRepo.setIcon', async () => {
    seed(cardHolding);

    const { getByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(holdingsRepo.setIcon).toHaveBeenCalledWith('h-1', 'basket');
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
    // derived entry's tone, not merely by the sign of the amount.
    const taxAmount = amountForLabel(getAllByText('Income tax 18%')[0]);
    expect(colorOf(taxAmount)).toBe(darkTheme.colors.negative);

    const interestAmount = amountForLabel(getAllByText('Interest accrual')[0]);
    expect(colorOf(interestAmount)).toBe(darkTheme.colors.positive);
  });

  it('colors a bond coupon green and the expected-profit line green', async () => {
    seed(bondHolding);

    const { getAllByText, getByText } = await renderScreen();

    // A net coupon (money in) reads green as an interest payment.
    const couponAmount = amountForLabel(getAllByText('Coupon')[0]);
    expect(colorOf(couponAmount)).toBe(darkTheme.colors.positive);

    // The whole-life expected-profit breakdown line reads green as the expected gain.
    const expectedProfitAmount = amountForLabel(getByText('Expected profit'));
    expect(colorOf(expectedProfitAmount)).toBe(darkTheme.colors.positive);
  });

  it('appends a contribution through the add-contribution action', async () => {
    seed(depositHolding);

    const { getByText, getByLabelText } = await renderScreen();

    await fireEvent.press(getByText('Add contribution'));
    await fireEvent.changeText(getByLabelText('Contribution amount'), '1000');
    await fireEvent.changeText(getByLabelText('Contribution date'), '2025-06-01');
    await fireEvent.press(getByText('Save contribution'));

    // The typed YYYY-MM-DD lands at LOCAL midnight of that day (matching
    // DateField and the interest boundaries), not the UTC midnight Date.parse
    // would give — which shifts a day off in a +2/+3 zone.
    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledWith('h-1', {
      amountMinorUnits: 100_000,
      date: new Date(2025, 5, 1).getTime(),
    });
  });

  it('does not append when the amount is blank', async () => {
    const { getByText, getByLabelText } = await openContributionForm();

    await fireEvent.changeText(getByLabelText('Contribution date'), '2025-06-01');
    await fireEvent.press(getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).not.toHaveBeenCalled();
  });

  it('does not append when the amount is zero', async () => {
    const { getByText, getByLabelText } = await openContributionForm();

    await fireEvent.changeText(getByLabelText('Contribution amount'), '0');
    await fireEvent.changeText(getByLabelText('Contribution date'), '2025-06-01');
    await fireEvent.press(getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).not.toHaveBeenCalled();
  });

  it('surfaces an alert and keeps the form open when the append fails', async () => {
    (holdingsRepo.appendDepositContribution as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByText, getByLabelText } = await openContributionForm();

    await fireEvent.changeText(getByLabelText('Contribution amount'), '1000');
    await fireEvent.changeText(getByLabelText('Contribution date'), '2025-06-01');
    await fireEvent.press(getByText('Save contribution'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // The form stays open on failure so the entered values are not lost.
    expect(getByText('Save contribution')).toBeTruthy();
    alertSpy.mockRestore();
  });
});
