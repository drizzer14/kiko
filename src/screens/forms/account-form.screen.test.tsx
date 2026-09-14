import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { accountKindSymbol } from '../../holdings/entity-symbols';
import { i18n } from '../../i18n';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '../../test-support/navigation-props';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

const { entityColors } = darkTheme.colors;

const HEX = /^#[0-9a-f]{6}$/i;

// Finds which theme entity-color swatch (if any) the ColorPicker currently
// marks selected, by its accessibility label, and resolves it back to a hex.
// `undefined` means no swatch matches the form's current effective color —
// the failure mode a stored '' or an unmapped kind/type used to produce.
const selectedSwatchHex = (
  getByLabelText: Awaited<ReturnType<typeof render>>['getByLabelText'],
): string | undefined => {
  for (const [name, hex] of Object.entries(entityColors)) {
    if (getByLabelText(`Color ${name}`).props.accessibilityState.selected) {
      return hex;
    }
  }
  return undefined;
};

const mockCreate = jest.fn();
const mockCreateCashAccount = jest.fn();
const mockSetIcon = jest.fn();
const mockUpdate = jest.fn();
const mockSaveToken = jest.fn();
const mockSaveCredentials = jest.fn();
const mockMonobankSync = jest.fn();
const mockCryptoSync = jest.fn();
const mockFetchAccount = jest.fn();

// The account the edit-mode form loads through useLiveQuery. `mock`-prefixed so
// the hoisted factory may close over it; create-mode tests leave it empty.
let mockAccounts: unknown[] = [];

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockAccounts }),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    createCashAccount: (...args: unknown[]) => mockCreateCashAccount(...args),
    setIcon: (...args: unknown[]) => mockSetIcon(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));
jest.mock('../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));
jest.mock('../../crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => ({
    isSyncing: false,
    error: undefined,
    sync: (...args: unknown[]) => mockMonobankSync(...args),
  }),
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => ({
    isSyncing: false,
    error: undefined,
    sync: (...args: unknown[]) => mockCryptoSync(...args),
  }),
}));
// The crypto create form now reuses the shared Wallet|Binance sync form
// (CryptoSyncForm). Its two leaf fields own their own inputs, validation, and
// Keychain writes (covered by their own tests); here each collapses to one
// pressable that fires the screen's `onConnect*` closure, so what is under test
// is the create screen's wiring (create-first, no duplicate, secret stays in the
// field).
jest.mock('../account-detail/wallet-address-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (address: string) => Promise<boolean> }) => (
      <Pressable
        accessibilityLabel="wallet-field"
        onPress={() => onConnect('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')}
      >
        <Text>wallet field</Text>
      </Pressable>
    ),
  };
});
jest.mock('../account-detail/binance-credentials-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: () => Promise<boolean> }) => (
      <Pressable accessibilityLabel="binance-field" onPress={() => onConnect()}>
        <Text>binance field</Text>
      </Pressable>
    ),
  };
});
// The bank create form now offers the SAME explicit-Connect pattern as crypto,
// through MonobankConnectField. It owns its own token input, live validation, and
// status (covered by its own test); here it collapses to one pressable that fires
// the screen's `connectMonobank` closure with a token, so what is under test is
// the create screen's wiring (create-first, no duplicate, secret via the closure).
jest.mock('../account-detail/monobank-connect-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (token: string) => Promise<boolean> }) => (
      <Pressable accessibilityLabel="monobank-field" onPress={() => onConnect('tok-123')}>
        <Text>monobank field</Text>
      </Pressable>
    ),
  };
});

type RouteParams = { accountId?: string };

const renderForm = async (
  params: RouteParams = {},
): Promise<Awaited<ReturnType<typeof render>> & { navigation: NavigationSpy }> => {
  const navigation = navigationSpy();
  const route = asRouteProp<AccountFormProps['route']>('AccountForm', params);
  const view = await render(
    <AccountFormScreen
      navigation={asNavigationProp<AccountFormProps['navigation']>(navigation)}
      route={route}
    />,
  );
  return { ...view, navigation };
};

describe('AccountFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No account loaded by default: create mode. Edit-mode tests seed this.
    mockAccounts = [];
    // create resolves to the new row's id so the form can set its icon on it.
    mockCreate.mockResolvedValue('new-account-id');
    // The credential writes resolve so the save flow can await them, and the
    // sync hooks resolve a boolean like the real fire-and-forget connect.
    mockSaveToken.mockResolvedValue(undefined);
    mockSaveCredentials.mockResolvedValue(undefined);
    mockMonobankSync.mockResolvedValue(true);
    mockCryptoSync.mockResolvedValue(true);
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderForm();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add account" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add account')).toBeNull();
  });

  it('separates the color picker and the synchronization sub-heading with form dividers', async () => {
    // Default create mode is a bank account, so the "Synchronization" sub-heading
    // renders: one divider sits after the color picker and one before that
    // sub-heading.
    const { getAllByTestId } = await renderForm();

    expect(getAllByTestId('form-divider')).toHaveLength(2);
  });

  it('marks only the required Name field with an asterisk', async () => {
    const { getByText, getAllByText } = await renderForm();

    // Name gates save (canSave = trimmed name), so it shows the marker; Kind and
    // Color are optional (they carry defaults), so no other asterisk renders.
    expect(getByText('Name')).toBeTruthy();
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('offers the three account kinds with humanized labels', async () => {
    const { getByText, queryByText } = await renderForm();

    expect(getByText('Bank')).toBeTruthy();
    expect(getByText('Cash')).toBeTruthy();
    expect(getByText('Crypto')).toBeTruthy();
    expect(queryByText('Broker')).toBeNull();
  });

  it('renders the account-type chips in the order Cash, Bank, Crypto', async () => {
    const { getAllByText } = await renderForm();

    // getAllByText returns matches in render (tree) order, and the ChipRow lays
    // its chips out in the `kinds` array order, so this asserts the visible
    // left-to-right order is Cash -> Bank -> Crypto.
    const order = getAllByText(/^(Cash|Bank|Crypto)$/).map((node) => node.props.children);

    expect(order).toEqual(['Cash', 'Bank', 'Crypto']);
  });

  it('creates a crypto account with the crypto kind (no source connected)', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Save'));

    // The row is inserted with the screen's pre-generated id (so a field Connect
    // could have keyed a Keychain write to it); no source was connected here.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Crypto', kind: 'crypto', color: null }),
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates one cash account for a double-tapped Save', async () => {
    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — firing two real
    // `fireEvent.press` calls back to back without awaiting between them trips
    // React's "overlapping act() calls" guard (each is independently wrapped
    // in its own act()), so the two presses are awaited sequentially instead;
    // the guard is still exercised because the write only resolves when this
    // test says so.
    let resolveWrite: () => void = () => {};
    mockCreateCashAccount.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));

    const save = getByText('Save');

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(mockCreateCashAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockCreateCashAccount).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this file's beforeEach) clears call history but
    // not a custom mockImplementation — reset it explicitly so it does not
    // leak this test's never-auto-resolving write into the next test.
    mockCreateCashAccount.mockReset();
  });

  it('creates a bank account without touching the cash-account path', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Bank'));
    await fireEvent.press(getByText('Save'));

    // The bank row now shares the crypto create path: it is inserted with the
    // screen's pre-generated id (so a field Connect could have keyed a Keychain
    // write to it), not a repo-assigned one.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null }),
    );
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

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null }),
    );
    // The icon is set on the same pre-generated id the row was created with.
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    expect(mockSetIcon).toHaveBeenCalledWith(createdId, 'banknote');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('opens the create form on the initial kind default icon (bank)', async () => {
    // A fresh create form starts on the bank kind, so its icon field must show
    // the bank default glyph rather than the neutral fallback.
    const { getByLabelText } = await renderForm();

    expect(getByLabelText(`Icon ${accountKindSymbol.bank}`)).toBeTruthy();
  });

  it('sets the icon to each account type default when its chip is selected', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.press(getByText('Cash'));
    expect(getByLabelText(`Icon ${accountKindSymbol.cash}`)).toBeTruthy();

    await fireEvent.press(getByText('Crypto'));
    expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();

    await fireEvent.press(getByText('Bank'));
    expect(getByLabelText(`Icon ${accountKindSymbol.bank}`)).toBeTruthy();
  });

  it('resets a hand-picked icon back to the new type default when the type changes', async () => {
    const { getByLabelText, getByText } = await renderForm();

    // The user overrides the default with a custom icon...
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon airplane'));
    expect(getByLabelText('Icon airplane')).toBeTruthy();

    // ...then switches type, which re-seeds the icon to the new type's default.
    await fireEvent.press(getByText('Crypto'));
    expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();
  });

  it('persists the initial kind default icon when the user does not change it', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null }),
    );
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    expect(mockSetIcon).toHaveBeenCalledWith(createdId, accountKindSymbol.bank);
  });

  it('does not set an icon when the user removes the default before saving', async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    // Removing clears the seeded default back to null, so the create path skips
    // setIcon and the row follows its kind default at display time.
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByText('Remove'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank', kind: 'bank', color: null }),
    );
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
    const { getByLabelText, getByPlaceholderText, getByText, getByTestId, navigation } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.changeText(getByLabelText('Initial value'), '250.50');
    await fireEvent.press(getByTestId('account-currency-field'));
    // Narrow by search: unfiltered, EUR sorts alphabetically by its localized
    // name ("Euro") outside the FlatList's virtualized initial window
    // (`initialNumToRender={15}`).
    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'EUR');
    await fireEvent.press(getByTestId('currency-option-EUR'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith({
      name: 'Wallet',
      currency: 'EUR',
      // Selecting the Cash kind seeds the icon field with the cash default,
      // which the atomic create persists (the user did not override it).
      icon: accountKindSymbol.cash,
      // No color was picked either, so the create passes an explicit null and the
      // row follows its cash kind default at display time.
      color: null,
      initialBalanceMinorUnits: 25050,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('offers only fiat currencies for a cash account (no BTC)', async () => {
    const { getByLabelText, getByPlaceholderText, getByText, getByTestId, queryByTestId } =
      await renderForm();
    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await fireEvent.press(getByText('Cash'));
    await fireEvent.press(getByTestId('account-currency-field'));
    // Narrow by search: unfiltered, USD ("US Dollar") and GBP ("British Pound
    // Sterling") both sort alphabetically by localized name outside the
    // FlatList's virtualized initial window (`initialNumToRender={15}`), and
    // no single query matches both, so search for each in turn.
    const search = getByPlaceholderText('Search by code or name');

    await fireEvent.changeText(search, 'USD');
    expect(getByTestId('currency-option-USD')).toBeTruthy();
    expect(queryByTestId('currency-option-BTC')).toBeNull();

    await fireEvent.changeText(search, 'GBP');
    expect(getByTestId('currency-option-GBP')).toBeTruthy();
    expect(queryByTestId('currency-option-BTC')).toBeNull();
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

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Bank',
        kind: 'bank',
        color: entityColors.violet,
      }),
    );
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

  it('resolves a stored empty-string color to a real swatch, not blank', async () => {
    mockAccounts = [{ id: 'acc-1', name: 'X', kind: 'cash', icon: null, color: '' }];
    const { getByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(selectedSwatchHex(getByLabelText)).toMatch(HEX);
  });

  it('resolves a since-removed account kind to a real swatch, not blank', async () => {
    // `broker` was a valid Account.kind once and was dropped; the schema enum
    // is TS-only with no CHECK constraint, so such a row can still exist.
    mockAccounts = [{ id: 'acc-1', name: 'X', kind: 'broker', icon: null, color: null }];
    const { getByLabelText } = await renderForm({ accountId: 'acc-1' });

    expect(selectedSwatchHex(getByLabelText)).toMatch(HEX);
  });
});

describe('AccountFormScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the kind/color/currency field chrome from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText, queryByText } = await renderForm();

    expect(getByLabelText('Назва')).toBeTruthy();
    expect(getByText('Колір')).toBeTruthy();
    expect(getByText('Вид')).toBeTruthy();
    expect(getByText('Банк')).toBeTruthy();
    expect(getByText('Готівка')).toBeTruthy();
    expect(getByText('Крипто')).toBeTruthy();
    expect(getByText('Зберегти')).toBeTruthy();
    expect(queryByText('Bank')).toBeNull();
  });
});

describe('AccountFormScreen — sync credentials on create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
    mockCreate.mockResolvedValue('new-account-id');
    mockSaveToken.mockResolvedValue(undefined);
    mockSaveCredentials.mockResolvedValue(undefined);
    mockMonobankSync.mockResolvedValue(true);
    mockCryptoSync.mockResolvedValue(true);
    // Validation resolves by default (a valid credential); a test that needs an
    // invalid one rejects these explicitly.
    mockFetchAccount.mockResolvedValue({});
  });

  it('connect creates the bank row once, saves the token to the Keychain, and syncs it', async () => {
    // The field's own Connect (mocked to fire with a token) drives the screen's
    // connectMonobank closure: create the row FIRST, store the secret keyed by
    // that pre-generated id, then start the first sync (Global Constraint 2 order).
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', name: 'My Bank' }),
    );
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    expect(mockSaveToken).toHaveBeenCalledWith(createdId, 'tok-123');
    expect(mockMonobankSync).toHaveBeenCalledWith(createdId);
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('connect then Save updates the same row — never a duplicate account', async () => {
    // Option A: the field's Connect already inserted the row. A later Save must
    // UPDATE that same row (persisting any name edit after connecting), never
    // insert a second account.
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('monobank-field'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1); // still one — Save took the update branch
    expect(mockUpdate).toHaveBeenCalledWith(
      (mockCreate.mock.calls[0][0] as { id: string }).id,
      expect.objectContaining({ name: 'My Bank' }),
    );
  });

  it('Save with no connect creates the bank row and stores no token', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'Plain Bank');
    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', name: 'Plain Bank' }),
    );
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
  });

  it('connecting a bank source locks the kind switch', async () => {
    // Connecting inserts the bank row via the shared latch; switching to crypto
    // afterwards would route Save to a SECOND create and orphan the bank row, so
    // the kind chip is disabled once connected.
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() =>
      expect(view.getByText('Crypto').parent?.props.accessibilityState.disabled).toBe(true),
    );
  });

  it('reuses the shared Wallet|Binance sync form (picker + fields) on the crypto create', async () => {
    // The crypto create form must present the SAME synchronization form as the
    // account-detail screen: a Wallet/Binance source picker and the matching
    // field, proving it reuses CryptoSyncForm rather than hand-rolling a second
    // Binance-only copy. The two secure API-key/secret TextFields are gone.
    const { getByLabelText, getByText, queryByLabelText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));

    expect(getByText('Wallet')).toBeTruthy();
    expect(getByText('Binance')).toBeTruthy();
    // Wallet is the default source, so its field shows first.
    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('API key')).toBeNull();

    await fireEvent.press(getByText('Binance'));
    expect(getByLabelText('binance-field')).toBeTruthy();
  });

  it('shows the crypto sync form immediately on selecting Crypto, with no name gate', async () => {
    // Full parity with the bank form: the sync form appears the moment Crypto is
    // selected, empty name or not. No account row is created without a name — that
    // is enforced at Connect/Save time, not by hiding the form.
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.press(getByText('Crypto'));

    // The Wallet source field (the default source) is present with no name typed.
    expect(getByLabelText('wallet-field')).toBeTruthy();
  });

  it('shows an "enter a name first" hint on the crypto form while the name is empty', async () => {
    const { getByLabelText, getByText, queryByTestId } = await renderForm();

    await fireEvent.press(getByText('Crypto'));
    // With no name, the hint explains why a Connect will not persist anything.
    expect(queryByTestId('crypto-sync-name-hint')).toBeTruthy();

    // Typing a name clears the hint — the source can now be connected.
    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    expect(queryByTestId('crypto-sync-name-hint')).toBeNull();
  });

  it('does not create a crypto account when a source Connect is tapped with an empty name', async () => {
    // The form is visible and a credential/address may be entered, but the Connect
    // must refuse to insert a row without a name (parity with the bank Save gate):
    // no create, no sync, and the hint stays visible so the user understands why.
    const { getByLabelText, getByText, queryByTestId } = await renderForm();

    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    // The kind switch must NOT lock — no row was started.
    expect(getByText('Bank').parent?.props.accessibilityState.disabled).toBe(false);
    expect(queryByTestId('crypto-sync-name-hint')).toBeTruthy();
  });

  it('does not create a crypto account when the Binance field Connect is tapped with an empty name', async () => {
    // Parity with the wallet-field case above, targeting the OTHER source field:
    // the empty-name reject must guard both CryptoSyncForm fields, not just Wallet.
    const { getByLabelText, getByText, queryByTestId } = await renderForm();

    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(getByText('Bank').parent?.props.accessibilityState.disabled).toBe(false);
    expect(queryByTestId('crypto-sync-name-hint')).toBeTruthy();
  });

  it('treats a whitespace-only name exactly like an empty name on the crypto form', async () => {
    // A name of only spaces must not satisfy canSave: the sync form still shows
    // (full parity, no gate on visibility), the hint stays up, and a Connect
    // creates nothing — trimmedName === '' is the same reject path as a truly
    // empty name.
    const { getByLabelText, getByText, queryByTestId } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Crypto'));

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByTestId('crypto-sync-name-hint')).toBeTruthy();

    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
  });

  it('retries the crypto create after an empty-name reject, once a valid name is entered', async () => {
    // The empty-name reject inside ensureCryptoAccount must leave no poisoned
    // latch behind: a first Connect with no name creates nothing, and a SECOND
    // Connect on the same field — after typing a valid name — must still succeed,
    // creating the account exactly once and running its sync.
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Crypto', kind: 'crypto' }),
    );
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await waitFor(() =>
      expect(mockCryptoSync).toHaveBeenCalledWith({
        providerId: 'btc_wallet',
        targetAccountId: createdId,
        address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      }),
    );
  });

  it("creates the crypto account first, then runs the wallet field's connect against its id", async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Crypto', kind: 'crypto' }),
    );
    // The wallet address is public, so it flows through the sync (no Keychain).
    await waitFor(() =>
      expect(mockCryptoSync).toHaveBeenCalledWith({
        providerId: 'btc_wallet',
        targetAccountId: createdId,
        address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      }),
    );
  });

  it("creates the crypto account first, then runs the Binance field's connect against its id", async () => {
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;
    await waitFor(() =>
      expect(mockCryptoSync).toHaveBeenCalledWith({
        providerId: 'binance',
        targetAccountId: createdId,
      }),
    );
    // The secret never reaches this screen — BinanceCredentialsField owns the
    // Keychain write — so the screen calls neither saveToken nor saveCredentials.
    expect(mockSaveToken).not.toHaveBeenCalled();
  });

  it('does not create a DUPLICATE crypto account when a field Connect is followed by Save', async () => {
    // Option A: the field's own Connect already inserted the row. A subsequent
    // Save must UPDATE that same row (persisting any later name/color/icon edit),
    // never insert a second account.
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // Still exactly one create; the edited name persists through update.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(createdId, { name: 'Renamed', color: null });
  });

  it('clears the create latch when a field-Connect create rejects, so Save re-attempts (no silent no-op)', async () => {
    // C-1: a rejected insert (DB locked/disk full) must not leave the one-shot
    // latch set — otherwise Save would take the UPDATE branch, match no row, and
    // silently goBack while no account exists. The first create rejects; the row
    // was never inserted, so Save must run a fresh CREATE (not a no-op update).
    mockCreate.mockRejectedValueOnce(new Error('db locked'));
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Binance'));
    // The field's Connect fails cleanly (no unhandled rejection); nothing saved.
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(navigation.goBack).not.toHaveBeenCalled();

    // Save re-attempts the create because the latch was cleared — proof the ref
    // was reset rather than pinned to the rejected promise.
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('locks the kind switch once a crypto source is connected, so Save cannot orphan the row', async () => {
    // C-3: connecting a source inserts the crypto row. Switching to Bank/Cash
    // afterwards would route Save to a SECOND create and orphan that row, so the
    // kind chip is disabled once connected — the Bank press is inert and Save
    // stays on the crypto UPDATE path.
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    // The kind chip is now disabled; pressing Bank is a no-op.
    expect(getByText('Bank').parent?.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(getByText('Bank'));
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // Still one create (crypto), no bank/cash create, and Save updated the row.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('creates an unconnected crypto account on Save when no source was connected', async () => {
    // A crypto account is valid without a connected source (the user connects one
    // later from its detail screen). Save with no field Connect inserts the row
    // exactly once and never touches a credential write or sync. Validation of a
    // bad credential — and the skip-the-write-but-still-create guarantee — now
    // lives in BinanceCredentialsField's own test, not here.
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(mockSaveToken).not.toHaveBeenCalled();
  });
});
