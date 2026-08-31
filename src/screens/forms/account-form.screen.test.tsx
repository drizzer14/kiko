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

describe('AccountFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers only Bank and Cash, not Crypto or Broker', async () => {
    const navigation = { goBack: jest.fn() } as never;
    const { getByText, queryByText } = await render(<AccountFormScreen navigation={navigation} />);

    expect(getByText('bank')).toBeTruthy();
    expect(getByText('cash')).toBeTruthy();
    expect(queryByText('crypto')).toBeNull();
    expect(queryByText('broker')).toBeNull();
  });

  it('creates a bank account without touching the cash-account path', async () => {
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <AccountFormScreen navigation={navigation} />,
    );

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('bank'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank' });
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a cash account atomically with the initial value', async () => {
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <AccountFormScreen navigation={navigation} />,
    );

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
