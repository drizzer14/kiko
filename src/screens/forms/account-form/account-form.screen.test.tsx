import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';
import { Money } from '../../../currency/money';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '../../../test-support/navigation-props';
import { darkTheme } from '../../../design-system/theme';
import { scrollToField } from '../scroll-to-field/scroll-to-field';
import { accountKindSymbol, genericEntitySymbol } from '../../../holdings/entity-symbols';

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

// Opens the AccountKindField sheet and picks the given kind — every kind
// switch goes through this trigger-press -> option-press pair, matching
// the field's own sheet-based interaction.
const selectKind = async (
  getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
  kind: 'bank' | 'cash' | 'crypto' | 'property' | 'metals',
): Promise<void> => {
  await fireEvent.press(getByTestId('account-kind-field'));
  await fireEvent.press(getByTestId(`account-kind-field-option-${kind}`));
};

// The AccountKindField trigger's own `disabled` accessibility state — the
// read-only-kind assertions used to read the ChipRow chip's parent
// `accessibilityState.disabled`; the field now carries it directly on its
// testID'd Pressable.
const isKindFieldDisabled = (
  getByTestId: Awaited<ReturnType<typeof render>>['getByTestId'],
): boolean => Boolean(getByTestId('account-kind-field').props.accessibilityState.disabled);

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

jest.mock('../../../db/use-live-query', () => ({
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
jest.mock('../../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));
jest.mock('../../../crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('../scroll-to-field/scroll-to-field');
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
jest.mock('../../account-detail/wallet-address-field', () => {
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
jest.mock('../../account-detail/binance-credentials-field', () => {
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
jest.mock('../../account-detail/monobank-connect-field', () => {
  const { useState } = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    // Unlike the wallet/binance mocks above, this one also surfaces the boolean
    // `connectMonobank` resolves to (via a testID) — proving the screen's
    // create -> saveToken -> sync chain actually propagates the sync outcome
    // back to the caller, rather than a mutant swallowing it (e.g. hard-coding
    // `true` or losing a rejection inside the try/catch).
    default: ({ onConnect }: { onConnect: (token: string) => Promise<boolean> }) => {
      const [result, setResult] = useState('');
      return (
        <Pressable
          accessibilityLabel="monobank-field"
          onPress={() => {
            onConnect('tok-123').then((connected: boolean) => setResult(String(connected)));
          }}
        >
          <Text>monobank field</Text>
          <Text testID="monobank-connect-result">{result}</Text>
        </Pressable>
      );
    },
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

  // DEVICE BUG fix (root cause): the currency sheet's search field lives
  // inside a Modal above this Screen's background ScrollView, which
  // otherwise misfires `automaticallyAdjustKeyboardInsets` for a responder
  // it does not contain. `CurrencyField`'s `onOpenChange` must gate that
  // prop off for exactly the window the sheet is open.
  it('suspends automaticallyAdjustKeyboardInsets on the background ScrollView while the currency sheet is open', async () => {
    const { getByTestId } = await renderForm();

    await selectKind(getByTestId, 'cash');

    expect(getByTestId('screen-scroll-view').props.automaticallyAdjustKeyboardInsets).toBe(true);

    await fireEvent.press(getByTestId('account-currency-field'));

    expect(getByTestId('screen-scroll-view').props.automaticallyAdjustKeyboardInsets).toBe(false);
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

  it('offers the four account kinds with humanized labels, and lists no other kind', async () => {
    const { getByTestId, queryByText } = await renderForm();

    await fireEvent.press(getByTestId('account-kind-field'));

    // Each row's text content is the label immediately followed by its
    // subtitle (no separator node between them), so this checks a leading
    // partial match rather than an exact one.
    expect(getByTestId('account-kind-field-option-bank')).toHaveTextContent('Bank', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-cash')).toHaveTextContent('Cash', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-crypto')).toHaveTextContent('Crypto', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-property')).toHaveTextContent('Property', {
      exact: false,
    });
    expect(queryByText('Broker')).toBeNull();
  });

  it('renders the account-kind sheet options in the order Bank, Cash, Crypto, Property, Metals, Debt', async () => {
    const { getByTestId, getAllByTestId } = await renderForm();

    await fireEvent.press(getByTestId('account-kind-field'));

    // AccountKindField lays its rows out in the `kinds` array order
    // (accountKindSymbol's own key order), so their testIDs mount in that
    // same top-to-bottom order. The regex excludes each row's own
    // `-description` child testID, which shares the same prefix.
    const order = getAllByTestId(/^account-kind-field-option-[a-z]+$/).map((node) =>
      (node.props.testID as string).replace('account-kind-field-option-', ''),
    );

    expect(order).toEqual(['bank', 'cash', 'crypto', 'property', 'metals', 'debt']);
  });

  it('shows a subtitle under every kind option in the sheet', async () => {
    const { getByTestId } = await renderForm();

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(getByTestId('account-kind-field-option-property-description')).toHaveTextContent(
      'Real estate, car, valuables, money you lent.',
    );
  });

  it('creates a crypto account with the crypto kind (no source connected)', async () => {
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
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

  it('creates a property account with the property kind (no bank/crypto section rendered)', async () => {
    // Property has no extra creation fields yet, so it shares the generic
    // create path with bank/crypto: the row inserts
    // with just name/kind/color/icon, and neither the cash currency fields nor
    // the bank/crypto sync sections render for it.
    const { getByLabelText, getByTestId, getByText, navigation, queryByText, queryByTestId } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My House');
    await selectKind(getByTestId, 'property');

    expect(queryByTestId('account-currency-field')).toBeNull();
    expect(queryByText('Synchronization')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My House', kind: 'property', color: null }),
    );
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a metals account with the metals kind (no bank/crypto section rendered)', async () => {
    // Metals has no extra creation fields yet, so it shares the generic
    // create path with bank/crypto/property: the row
    // inserts with just name/kind/color/icon, and neither the cash currency
    // fields nor the bank/crypto sync sections render for it.
    const { getByLabelText, getByTestId, getByText, navigation, queryByText, queryByTestId } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Gold');
    await selectKind(getByTestId, 'metals');

    expect(queryByTestId('account-currency-field')).toBeNull();
    expect(queryByText('Synchronization')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Gold', kind: 'metals', color: null }),
    );
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

    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');

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
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await selectKind(getByTestId, 'bank');
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
    const { getByLabelText, getByTestId } = await renderForm();

    // Choosing Cash must not hide the icon picker — every kind, cash included,
    // can pick an icon in the create form now.
    await selectKind(getByTestId, 'cash');

    expect(getByLabelText('Change Icon')).toBeTruthy();
  });

  it('persists a picked icon on a cash account created atomically', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
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

  it('sets the icon to each account type default when its kind is selected', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'cash');
    expect(getByLabelText(`Icon ${accountKindSymbol.cash}`)).toBeTruthy();

    await selectKind(getByTestId, 'crypto');
    expect(getByLabelText(`Icon ${accountKindSymbol.crypto}`)).toBeTruthy();

    await selectKind(getByTestId, 'property');
    expect(getByLabelText(`Icon ${accountKindSymbol.property}`)).toBeTruthy();

    await selectKind(getByTestId, 'bank');
    expect(getByLabelText(`Icon ${accountKindSymbol.bank}`)).toBeTruthy();
  });

  it('resets a hand-picked icon back to the new type default when the type changes', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    // The user overrides the default with a custom icon (from the Kiko Entities
    // pool the account form now offers)...
    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon giftcard'));
    expect(getByLabelText('Icon giftcard')).toBeTruthy();

    // ...then switches type, which re-seeds the icon to the new type's default.
    await selectKind(getByTestId, 'crypto');
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

  it('falls the account icon field back to the generic tray glyph once the icon is removed', async () => {
    // Clearing the icon (Change Icon -> Remove) drops the field to its generic
    // fallback. The icon rework decided that generic account glyph is `tray`
    // (genericEntitySymbol.account), never the retired `square.grid.2x2` — the
    // "never keep the old icon" rule.
    const { getByLabelText, getByText } = await renderForm();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByText('Remove'));

    expect(getByLabelText(`Icon ${genericEntitySymbol.account}`)).toBeTruthy();
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

  it('shows the name-required error directly on the name field, not as a separate block, on a blocked Save press', async () => {
    const { getByText, queryByTestId, getByTestId } = await renderForm();

    await fireEvent.press(getByText('Save'));

    expect(getByText('Enter a name.')).toBeTruthy();
    // The old standalone block is gone — the message now lives on the field.
    expect(queryByTestId('account-name-error')).toBeNull();
    expect(getByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('scrolls to the name field when Save is pressed while it is empty', async () => {
    const { getByText } = await renderForm();

    await fireEvent.press(getByText('Save'));

    expect(scrollToField).toHaveBeenCalled();
  });

  it('clamps a negative cash initial value to zero', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.changeText(getByLabelText('Initial value'), '-50');
    await fireEvent.press(getByText('Save'));

    expect(mockCreateCashAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wallet', initialBalance: Money.of('UAH', 0) }),
    );
  });

  it('creates a cash account atomically with the initial value', async () => {
    const { getByLabelText, getByPlaceholderText, getByText, getByTestId, navigation } =
      await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
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
      initialBalance: Money.of('EUR', 25050),
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('offers only fiat currencies for a cash account (no BTC)', async () => {
    const { getByLabelText, getByPlaceholderText, getByTestId, queryByTestId } = await renderForm();
    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
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

  it('surfaces an alert and does not navigate when the cash create fails', async () => {
    mockCreateCashAccount.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
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
    const { getByLabelText, getByTestId } = await renderForm();

    // bank default is white; switching to crypto swaps the selected default
    // swatch to yellow, because the color has not been manually picked.
    await selectKind(getByTestId, 'crypto');

    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(false);
  });

  it('keeps a manually picked color when the kind changes afterwards (dirty)', async () => {
    const { getByLabelText, getByTestId } = await renderForm();

    await fireEvent.press(getByLabelText('Color violet'));

    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);

    await selectKind(getByTestId, 'crypto');

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
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'Wallet');
    await selectKind(getByTestId, 'cash');
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
    const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

    // The kind field still shows Bank selected, but pressing it is inert — the
    // sheet never opens, so no option row mounts.
    expect(getByTestId('account-kind-field')).toHaveTextContent('Bank');
    expect(isKindFieldDisabled(getByTestId)).toBe(true);
    await fireEvent.press(getByTestId('account-kind-field'));
    expect(() => getByTestId('account-kind-field-option-crypto')).toThrow();

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
      bankId: null,
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

  it('edit-hydrates bankId from the stored row and shows it pre-selected in the bank picker', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'privatbank' },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-bank-type-field')).toHaveTextContent('PrivatBank');
  });

  // The "Synchronization" heading renders above the bank picker in edit
  // mode too, not just create — otherwise that block sits under a bare
  // divider with no section name at all.
  it('shows the Synchronization heading above the bank picker in edit mode too', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'privatbank' },
    ];
    const { getByText } = await renderForm({ accountId: 'acc-1' });

    expect(getByText('Synchronization')).toBeTruthy();
  });

  it('edit form’s bank picker lists the same six banks the create form does, plus "Free"', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: null },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByTestId('account-bank-type-field'));

    expect(getByTestId('bank-type-option-none')).toBeTruthy();
    expect(getByTestId('bank-type-option-monobank')).toBeTruthy();
    expect(getByTestId('bank-type-option-privatbank')).toBeTruthy();
    expect(getByTestId('bank-type-option-sensebank')).toBeTruthy();
    expect(getByTestId('bank-type-option-procredit')).toBeTruthy();
    expect(getByTestId('bank-type-option-ukrsib')).toBeTruthy();
    expect(getByTestId('bank-type-option-alfa')).toBeTruthy();
  });

  it('opens with "Free" selected for an account with no bankId', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: null },
    ];
    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByTestId('account-bank-type-field'));

    expect(getByTestId('bank-type-option-none').props.accessibilityState.selected).toBe(true);
  });

  it('persists a newly-picked bankId on Save (null -> privatbank)', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: null },
    ];
    const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByTestId('account-bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-privatbank'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ bankId: 'privatbank' }),
    );
  });

  it('persists clearing a picked bankId back to null on Save (privatbank -> "Free")', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: 'privatbank' },
    ];
    const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByTestId('account-bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-none'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', expect.objectContaining({ bankId: null }));
  });

  it('saves fine leaving bankId null when the picker is never touched (no forced selection)', async () => {
    mockAccounts = [
      { id: 'acc-1', name: 'Card', kind: 'bank', icon: null, color: null, bankId: null },
    ];
    const { getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', expect.objectContaining({ bankId: null }));
  });

  it('keeps a live-connected Monobank account’s sync intact when its bankId is edited', async () => {
    // bankId is identity-only and deliberately never read by isSyncedAccount
    // or the provider registry (kiko-domain) — the picker stays fully
    // editable even for a connected account, and the update patch it drives
    // never carries `institution`, so the live connection can never be
    // touched from here.
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'Monobank Card',
        kind: 'bank',
        icon: null,
        color: null,
        bankId: 'monobank',
        institution: 'monobank',
      },
    ];
    const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

    await fireEvent.press(getByTestId('account-bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-privatbank'));
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', {
      name: 'Monobank Card',
      color: null,
      bankId: 'privatbank',
    });
    const patch = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect('institution' in patch).toBe(false);
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

    const { getByLabelText, getByTestId, getByText, queryByText } = await renderForm();

    expect(getByLabelText('Назва')).toBeTruthy();
    expect(getByText('Колір')).toBeTruthy();
    expect(getByText('Вид')).toBeTruthy();
    // The trigger shows the default (bank) kind's translated label without
    // opening the sheet.
    expect(getByTestId('account-kind-field')).toHaveTextContent('Банк');

    await fireEvent.press(getByTestId('account-kind-field'));
    expect(getByTestId('account-kind-field-option-cash')).toHaveTextContent('Готівка', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-crypto')).toHaveTextContent('Крипто', {
      exact: false,
    });
    expect(getByTestId('account-kind-field-option-property')).toHaveTextContent('Майно', {
      exact: false,
    });

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
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
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
    // connectMonobank must resolve to the sync's own outcome, not a hard-coded
    // `true` — proves `return syncMonobank(...)` actually propagates.
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('true'),
    );
  });

  it('resolves connectMonobank to false when the sync itself fails (no thrown error)', async () => {
    // A sync that resolves false (not a rejection) is a distinct outcome from a
    // thrown create/saveToken error below: the token was stored fine, but the
    // sync did not succeed. The result must still propagate as false.
    mockMonobankSync.mockResolvedValue(false);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalled());
    expect(mockSaveToken).toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
  });

  it('does not save a token or sync when the bank row create rejects', async () => {
    // Mirrors the crypto create-reject coverage (C-1) for the bank-specific
    // connectMonobank closure: a failed create must short-circuit BEFORE
    // saveToken/sync ever run, and connectMonobank must resolve to false (its
    // own try/catch), not throw or resolve true.
    mockCreate.mockRejectedValueOnce(new Error('db locked'));
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
    // No row was actually inserted (the create latch was reset), so the kind
    // switch must not lock.
    expect(isKindFieldDisabled(view.getByTestId)).toBe(false);
  });

  it('does not sync when saving the token to the Keychain fails', async () => {
    // Unique to the bank flow (crypto has no saveToken step): the row IS
    // created successfully, but the Keychain write throws. connectMonobank's
    // own try/catch must still resolve false and must never call syncMonobank.
    mockSaveToken.mockRejectedValueOnce(new Error('keychain write failed'));
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockSaveToken).toHaveBeenCalledTimes(1));
    expect(mockMonobankSync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
    // Unlike a create failure, the row itself was created before saveToken
    // threw, so the kind switch stays locked — the latch was never reset.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(isKindFieldDisabled(view.getByTestId)).toBe(true);
  });

  it('resolves connectMonobank to false, not a rejection, when ensureAccount throws synchronously', async () => {
    // Provokes the synchronous throw ensureAccount's name-required branch can
    // raise (here, a scrollToField layout failure) BEFORE it reaches its own
    // `return Promise.reject(...)` — proving `accountEnsured` still resolves
    // false instead of leaving `connectMonobank` a rejected promise.
    (scrollToField as jest.Mock).mockImplementationOnce(() => {
      throw new Error('layout not ready');
    });
    const view = await renderForm();

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() =>
      expect(view.getByTestId('monobank-connect-result')).toHaveTextContent('false'),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('connect then Save updates the same row — never a duplicate account', async () => {
    // Option A: the field's Connect already inserted the row. A later Save must
    // UPDATE that same row (persisting any name edit after connecting), never
    // insert a second account.
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
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

  // "Free" (not a placeholder) is the default bank shown.
  it('does not auto-select any bank on a fresh bank create (no auto-jump to Monobank)', async () => {
    const view = await renderForm();

    await selectKind(view.getByTestId, 'bank');

    expect(view.getByText('Free')).toBeTruthy();
    expect(view.queryByLabelText('monobank-field')).toBeNull();
  });

  it('lists all six banks in the picker sheet', async () => {
    const view = await renderForm();

    await fireEvent.press(view.getByLabelText('Bank type'));

    expect(view.getByTestId('bank-type-option-monobank')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-privatbank')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-sensebank')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-procredit')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-ukrsib')).toBeTruthy();
    expect(view.getByTestId('bank-type-option-alfa')).toBeTruthy();
  });

  it('creates the bank row tagged with the selected bank id when connecting Monobank', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ bankId: 'monobank' }));
  });

  it('shows no fake connect field for an import-only bank, and creates the row tagged with its bank id on Save', async () => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My PrivatBank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-privatbank'));

    expect(view.queryByLabelText('monobank-field')).toBeNull();
    expect(view.getByText('PrivatBank')).toBeTruthy();

    await fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(view.navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My PrivatBank', kind: 'bank', bankId: 'privatbank' }),
    );
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
  });

  it('connecting a bank source locks the kind switch', async () => {
    // Connecting inserts the bank row via the shared latch; switching to crypto
    // afterwards would route Save to a SECOND create and orphan the bank row, so
    // the kind field is disabled once connected.
    mockMonobankSync.mockResolvedValue(true);
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    await waitFor(() => expect(isKindFieldDisabled(view.getByTestId)).toBe(true));
  });

  it('shows the name-required reason only after a Connect is attempted with an empty name, on the bank form', async () => {
    const view = await renderForm();

    expect(view.queryByTestId('holding-identity-name-field-error')).toBeNull();

    await fireEvent.press(view.getByLabelText('Bank type'));
    await fireEvent.press(view.getByTestId('bank-type-option-monobank'));
    await fireEvent.press(view.getByLabelText('monobank-field'));

    expect(view.queryByTestId('holding-identity-name-field-error')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText('Name'), 'My Bank');
    expect(view.queryByTestId('holding-identity-name-field-error')).toBeNull();
  });

  it('reuses the shared Wallet|Binance sync form (picker + fields) on the crypto create', async () => {
    // The crypto create form must present the SAME synchronization form as the
    // account-detail screen: a Wallet/Binance source picker and the matching
    // field, proving it reuses CryptoSyncForm rather than hand-rolling a second
    // Binance-only copy. The two secure API-key/secret TextFields are gone.
    const { getByLabelText, getByTestId, getByText, queryByLabelText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');

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
    const { getByLabelText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');

    // The Wallet source field (the default source) is present with no name typed.
    expect(getByLabelText('wallet-field')).toBeTruthy();
  });

  it('shows the name-required reason only after a Connect is attempted with an empty name, on the crypto form', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();

    await fireEvent.press(getByLabelText('wallet-field'));
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();
  });

  it('does not create a crypto account when a source Connect is tapped with an empty name', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(isKindFieldDisabled(getByTestId)).toBe(false);
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('does not create a crypto account when the Binance field Connect is tapped with an empty name', async () => {
    const { getByLabelText, getByTestId, getByText, queryByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(isKindFieldDisabled(getByTestId)).toBe(false);
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('treats a whitespace-only name exactly like an empty name on the crypto form', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await selectKind(getByTestId, 'crypto');

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();

    await fireEvent.press(getByLabelText('wallet-field'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(queryByTestId('holding-identity-name-field-error')).toBeTruthy();
  });

  it('retries the crypto create after an empty-name reject, once a valid name is entered', async () => {
    // The empty-name reject inside ensureAccount must leave no poisoned
    // latch behind: a first Connect with no name creates nothing, and a SECOND
    // Connect on the same field — after typing a valid name — must still succeed,
    // creating the account exactly once and running its sync.
    const { getByLabelText, getByTestId } = await renderForm();

    await selectKind(getByTestId, 'crypto');
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
    const { getByLabelText, getByTestId } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
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
    const { getByLabelText, getByTestId, getByText } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
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
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const createdId = (mockCreate.mock.calls[0][0] as { id: string }).id;

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // Still exactly one create; the edited name persists through update.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(createdId, {
      name: 'Renamed',
      color: null,
      bankId: null,
    });
  });

  it('clears the create latch when a field-Connect create rejects, so Save re-attempts (no silent no-op)', async () => {
    // C-1: a rejected insert (DB locked/disk full) must not leave the one-shot
    // latch set — otherwise Save would take the UPDATE branch, match no row, and
    // silently goBack while no account exists. The first create rejects; the row
    // was never inserted, so Save must run a fresh CREATE (not a no-op update).
    mockCreate.mockRejectedValueOnce(new Error('db locked'));
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
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
    // kind field is disabled once connected — pressing it is inert, and Save
    // stays on the crypto UPDATE path.
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Binance'));
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    // The kind field is now disabled; pressing it never opens the sheet.
    expect(isKindFieldDisabled(getByTestId)).toBe(true);
    await fireEvent.press(getByTestId('account-kind-field'));
    expect(() => getByTestId('account-kind-field-option-bank')).toThrow();

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
    const { getByLabelText, getByTestId, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await selectKind(getByTestId, 'crypto');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(mockSaveToken).not.toHaveBeenCalled();
  });
});
