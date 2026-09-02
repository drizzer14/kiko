import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import HoldingDetailScreen from './holding-detail.screen';

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

// Key each live-query result to its tag so a state-driven re-render (e.g. the
// add-contribution form) keeps returning the same data instead of draining a
// one-shot queue.
const seed = (holding: unknown, transactions: unknown[] = []): void => {
  mockUseLiveQuery.mockImplementation((_query: unknown, keys: string[]) =>
    keys[0] === 'holdings' ? { data: [holding] } : { data: transactions },
  );
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

  it('shows gross, interest, and tax detail for a taxable deposit', async () => {
    seed(depositHolding);

    const { getByText } = await renderScreen();

    expect(getByText('Value')).toBeTruthy();
    expect(getByText('Gross value')).toBeTruthy();
    expect(getByText('Interest earned')).toBeTruthy();
    expect(getByText('Tax withheld')).toBeTruthy();
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

  it('renders computed derived entries (contribution, interest, tax) for a deposit, marked Computed', async () => {
    seed(depositHolding);

    const { getByText, getAllByText } = await renderScreen();

    // derivedEntries yields a Contribution row plus Interest and Tax rows once
    // the deposit has accrued. These read distinctly from the value-breakdown
    // labels ("Interest earned"/"Tax withheld").
    expect(getByText('Contribution')).toBeTruthy();
    expect(getByText('Interest')).toBeTruthy();
    expect(getByText('Tax')).toBeTruthy();
    // Every derived row carries a "Computed" marker so it reads as derived.
    expect(getAllByText(/^Computed ·/).length).toBeGreaterThanOrEqual(3);
  });

  it('renders derived rows read-only: no swipe-delete and not tappable to the form', async () => {
    seed(depositHolding);

    const { getByText, queryByLabelText } = await renderScreen();

    // A derived-only deposit (no real transactions) offers no delete action at all.
    expect(queryByLabelText('Delete', { includeHiddenElements: true })).toBeNull();
    // Pressing a derived row's label opens no transaction form.
    await fireEvent.press(getByText('Contribution'));
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

    // Both the real transaction and the derived contribution render together.
    expect(getByText('Fee')).toBeTruthy();
    expect(getByText('Contribution')).toBeTruthy();
    // Only the real row is deletable; the derived rows expose no delete action.
    expect(getByLabelText('Delete', { includeHiddenElements: true })).toBeTruthy();
  });

  it('appends a contribution through the add-contribution action', async () => {
    seed(depositHolding);

    const { getByText, getByLabelText } = await renderScreen();

    await fireEvent.press(getByText('Add contribution'));
    await fireEvent.changeText(getByLabelText('Contribution amount'), '1000');
    await fireEvent.changeText(getByLabelText('Contribution date'), '2025-06-01');
    await fireEvent.press(getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledWith('h-1', {
      amountMinorUnits: 100_000,
      date: Date.parse('2025-06-01'),
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
