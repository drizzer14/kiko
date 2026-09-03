import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import AccountFormScreen from './account-form.screen';

const { entityColors } = darkTheme.colors;

const mockCreate = jest.fn();
const mockCreateCashAccount = jest.fn();
const mockSetIcon = jest.fn();
const mockUpdate = jest.fn();

// The account the edit-mode form loads through useLiveQuery. `mock`-prefixed so
// the hoisted factory may close over it; create-mode tests leave it empty.
let mockAccounts: unknown[] = [];

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockAccounts }),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    createCashAccount: (...args: unknown[]) => mockCreateCashAccount(...args),
    setIcon: (...args: unknown[]) => mockSetIcon(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

type RouteParams = { accountId?: string };

const renderForm = async (
  params: RouteParams = {},
): Promise<
  ReturnType<typeof render> & { navigation: { goBack: jest.Mock; setOptions: jest.Mock } }
> => {
  const navigation = { goBack: jest.fn(), setOptions: jest.fn() };
  const route = { params } as never;
  const view = await render(<AccountFormScreen navigation={navigation as never} route={route} />);
  return { ...view, navigation };
};

describe('AccountFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No account loaded by default: create mode. Edit-mode tests seed this.
    mockAccounts = [];
    // create resolves to the new row's id so the form can set its icon on it.
    mockCreate.mockResolvedValue('new-account-id');
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderForm();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add account" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add account')).toBeNull();
  });

  it('offers the three account kinds with humanized labels', async () => {
    const { getByText, queryByText } = await renderForm();

    expect(getByText('Bank')).toBeTruthy();
    expect(getByText('Cash')).toBeTruthy();
    expect(getByText('Crypto')).toBeTruthy();
    expect(queryByText('Broker')).toBeNull();
  });

  it('creates a crypto account with the crypto kind', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Crypto', kind: 'crypto', color: null });
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a bank account without touching the cash-account path', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Bank'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank', color: null });
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('keeps the icon field visible after selecting the Cash kind', async () => {
    const { getByLabelText, getByText } = await renderForm();

    // Choosing Cash must not hide the icon picker — every kind, cash included,
    // can pick an icon in the create form now.
    await fireEvent.press(getByText('Cash'));

    expect(getByLabelText('Change Icon')).toBeTruthy();
  });

  it('persists a picked icon on a cash account created atomically', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon banknote'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', icon: 'banknote' }),
    );
  });

  it('sets the picked icon on the new account using the returned id', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon banknote'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank', color: null });
    expect(mockSetIcon).toHaveBeenCalledWith('new-account-id', 'banknote');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not set an icon when none is picked', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank', color: null });
    expect(mockSetIcon).not.toHaveBeenCalled();
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
    await fireEvent.press(getByText('Cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '-50');
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', initialBalanceMinorUnits: 0 }),
    );
  });

  it('creates a cash account atomically with the initial value', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '250.50');
    await fireEvent.press(getByText('EUR'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith({
      name: 'Wallet',
      currency: 'EUR',
      // No icon was picked, so the create passes an explicit null.
      icon: null,
      // No color was picked either, so the create passes an explicit null and the
      // row follows its cash kind default at display time.
      color: null,
      initialBalanceMinorUnits: 25050,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('AccountFormScreen color follows kind until dirty', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue('new-account-id');
  });

  it("selects the default kind's color before any pick (bank -> white)", async () => {
    const { getByLabelText } = await renderForm();

    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(true);
  });

  it('re-derives the color to the newly selected kind default while not dirty', async () => {
    const { getByLabelText, getByText } = await renderForm();

    // bank default is white; switching to crypto swaps the selected default
    // swatch to yellow, because the color has not been manually picked.
    await fireEvent.press(getByText('Crypto'));

    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(false);
  });

  it('keeps a manually picked color when the kind changes afterwards (dirty)', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.press(getByLabelText('Color violet'));

    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(getByText('Crypto'));

    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(false);
  });

  it('persists the manually picked color on a bank account', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByLabelText('Color violet'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({
      name: 'My Bank',
      kind: 'bank',
      color: entityColors.violet,
    });
  });

  it('persists the manually picked color on a cash account', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.press(getByLabelText('Color violet'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', color: entityColors.violet }),
    );
  });
});

describe('AccountFormScreen edit mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Ukrsibbank Card',
        kind: 'bank',
        icon: 'banknote',
        color: entityColors.violet,
      },
    ];
  });

  it('sets the header title to "Edit Account"', async () => {
    const { navigation } = await renderForm({ accountId: 'acc-1' });

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Account' });
  });

  it('seeds the name field from the existing account', async () => {
    const { getByDisplayValue } = await renderForm({ accountId: 'acc-1' });

    expect(getByDisplayValue('Ukrsibbank Card')).toBeTruthy();
  });

  it('seeds the stored icon and color as the selected swatch', async () => {
    const { getByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(getByLabelText('Icon banknote')).toBeTruthy();
    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
  });

  it('shows the kind read-only (disabled) so it cannot change after creation', async () => {
    const { getByText } = await renderForm({ accountId: 'acc-1' });

    // The kind chip still shows Bank selected, but pressing another kind is inert.
    expect(getByText('Bank').parent?.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(getByText('Crypto'));
    // Save still routes to the account's original kind via update (never create).
    await fireEvent.press(getByText('Save'));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does not render the cash currency or initial-value fields in edit mode', async () => {
    mockAccounts = [{ id: 'acc-1', name: 'Wallet', kind: 'cash', icon: null, color: null }];
    const { queryByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(queryByLabelText('Initial value')).toBeNull();
  });

  it('saves through the update path with the edited name and color, and sets the icon', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed account');
    await fireEvent.press(getByLabelText('Color teal'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', {
      name: 'Renamed account',
      color: entityColors.teal,
    });
    expect(mockSetIcon).toHaveBeenCalledWith('acc-1', 'banknote');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not save an empty (whitespace-only) edited name', async () => {
    const { getByLabelText, getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
