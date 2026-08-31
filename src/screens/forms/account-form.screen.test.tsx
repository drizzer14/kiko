import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import AccountFormScreen from './account-form.screen';

const mockCreate = jest.fn();
const mockCreateAndReturn = jest.fn();
const mockHoldingsCreate = jest.fn();

jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    create: (...args: unknown[]) => mockCreate(...args),
    createAndReturn: (...args: unknown[]) => mockCreateAndReturn(...args),
  },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    create: (...args: unknown[]) => mockHoldingsCreate(...args),
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

  it('creates a bank account without touching holdingsRepo', async () => {
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <AccountFormScreen navigation={navigation} />,
    );

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('bank'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank' });
    expect(mockCreateAndReturn).not.toHaveBeenCalled();
    expect(mockHoldingsCreate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a cash account and an attached cash holding with the initial value', async () => {
    mockCreateAndReturn.mockResolvedValue('acc-1');
    const navigation = { goBack: jest.fn() } as never;
    const { getByLabelText, getByText } = await render(
      <AccountFormScreen navigation={navigation} />,
    );

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '250.50');
    await fireEvent.press(getByText('EUR'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateAndReturn).toHaveBeenCalledWith({ name: 'Wallet', kind: 'cash' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockHoldingsCreate).toHaveBeenCalledWith({
      accountId: 'acc-1',
      name: 'Wallet',
      type: 'cash',
      currency: 'EUR',
      balanceMinorUnits: 25050,
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
