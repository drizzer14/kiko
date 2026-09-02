import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import AccountFormScreen from './account-form.screen';

const mockCreate = jest.fn();
const mockCreateCashAccount = jest.fn();

jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    create: (...args: unknown[]) => mockCreate(...args),
    createCashAccount: (...args: unknown[]) => mockCreateCashAccount(...args),
  },
}));

const renderForm = async (): Promise<
  ReturnType<typeof render> & { navigation: { goBack: jest.Mock } }
> => {
  const navigation = { goBack: jest.fn() };
  const view = await render(<AccountFormScreen navigation={navigation as never} />);
  return { ...view, navigation };
};

describe('AccountFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderForm();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add account" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add account')).toBeNull();
  });

  it('offers the three account kinds', async () => {
    const { getByText, queryByText } = await renderForm();

    expect(getByText('bank')).toBeTruthy();
    expect(getByText('cash')).toBeTruthy();
    expect(getByText('crypto')).toBeTruthy();
    expect(queryByText('broker')).toBeNull();
  });

  it('creates a crypto account with the crypto kind', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('crypto'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Crypto', kind: 'crypto' });
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a bank account without touching the cash-account path', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('bank'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank' });
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not create an account when the name is empty (or whitespace only)', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('clamps a negative cash initial value to zero', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '-50');
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', initialBalanceMinorUnits: 0 }),
    );
  });

  it('creates a cash account atomically with the initial value', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '250.50');
    await fireEvent.press(getByText('EUR'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith({
      name: 'Wallet',
      currency: 'EUR',
      initialBalanceMinorUnits: 25050,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
