import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
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
const mockFetchClientInfo = jest.fn();
const mockFetchAccount = jest.fn();

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
jest.mock('../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));
jest.mock('../../monobank/monobank.client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('../../crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('../use-sync', () => ({
  useSync: () => ({
    isSyncing: false,
    error: undefined,
    sync: (...args: unknown[]) => mockMonobankSync(...args),
  }),
}));
jest.mock('../use-crypto-sync', () => ({
  useCryptoSync: () => ({
    isSyncing: false,
    error: undefined,
    sync: (...args: unknown[]) => mockCryptoSync(...args),
  }),
}));

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

  it('creates a crypto account with the crypto kind', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Crypto', kind: 'crypto', color: null });
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

    expect(mockCreate).toHaveBeenCalledWith({ name: 'My Bank', kind: 'bank', color: null });
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('reuses the syncable Monobank token entry (API link + paste icon) on the create form', async () => {
    // The bank create form must offer the SAME token-entry surface as the
    // account-detail edit screen: the "Open api.monobank.ua" link and the
    // paste-from-clipboard icon button, proving both consume the shared input
    // rather than the old stripped-down bare TextField.
    const { getByText, getByLabelText } = await renderForm();

    // Default create mode is a bank account, so the entry surface is present.
    expect(getByText('Open api.monobank.ua')).toBeTruthy();
    expect(getByLabelText('Paste from clipboard')).toBeTruthy();
  });

  it('omits the Disconnect action from the bank create form', async () => {
    // Disconnect is an edit-surface-only concern: on a fresh create there is
    // nothing connected to disconnect, so the shared input must not carry it.
    const { queryByText } = await renderForm();

    expect(queryByText('Disconnect')).toBeNull();
    expect(queryByText('Disconnect Monobank')).toBeNull();
  });

  it('fills the create-form token field from the clipboard via the shared paste icon', async () => {
    const Clipboard = require('@react-native-clipboard/clipboard');
    Clipboard.getString.mockResolvedValue('  pasted-token\n');

    const { getByLabelText, findByDisplayValue } = await renderForm();

    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });

    // The pasted value is trimmed before it reaches the field, mirroring the
    // edit surface's paste behavior.
    expect(await findByDisplayValue('pasted-token')).toBeTruthy();
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
    mockFetchClientInfo.mockResolvedValue({ name: 'Test' });
    mockFetchAccount.mockResolvedValue({});
  });

  it('saves the Monobank token and connects when a bank create enters one', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Bank'));
    await fireEvent.changeText(getByLabelText('Token'), 'tok_123');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveToken).toHaveBeenCalledWith('tok_123');
    expect(mockMonobankSync).toHaveBeenCalledWith('new-account-id');
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  it('creates a bank account with no token without saving or connecting', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Bank'));
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
  });

  it('saves the Binance credentials and connects when a crypto create enters both', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.changeText(getByLabelText('API key'), 'key_1');
    await fireEvent.changeText(getByLabelText('API secret'), 'secret_1');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveCredentials).toHaveBeenCalledWith({ apiKey: 'key_1', secret: 'secret_1' });
    expect(mockCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'new-account-id',
    });
    expect(mockSaveToken).not.toHaveBeenCalled();
  });

  it('does not save or connect a crypto create missing the secret', async () => {
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.changeText(getByLabelText('API key'), 'key_1');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
  });

  it('still leaves without a duplicate account when the Keychain write rejects', async () => {
    // Validation passes but the Keychain write fails after the row already
    // exists: save() must not reject (which would skip goBack and let a second
    // Save press create a DUPLICATE) — it swallows and leaves.
    mockSaveToken.mockRejectedValue(new Error('keychain failure'));
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Bank'));
    await fireEvent.changeText(getByLabelText('Token'), 'tok_123');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // The account was created exactly once; the rejected write did not re-arm
    // Save into a second create.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('never writes an invalid Monobank token to the Keychain, but still creates the account', async () => {
    // Validation rejects (a bad token). The write is SKIPPED so a previously
    // stored valid token in the single global Keychain slot is not clobbered.
    mockFetchClientInfo.mockRejectedValue(new Error('invalid token'));
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Bank');
    await fireEvent.press(getByText('Bank'));
    await fireEvent.changeText(getByLabelText('Token'), 'bad_token');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('never writes invalid Binance credentials to the Keychain, but still creates the account', async () => {
    mockFetchAccount.mockRejectedValue(new Error('invalid key'));
    const { getByLabelText, getByText, navigation } = await renderForm();

    await fireEvent.changeText(getByLabelText('Name'), 'My Crypto');
    await fireEvent.press(getByText('Crypto'));
    await fireEvent.changeText(getByLabelText('API key'), 'key_1');
    await fireEvent.changeText(getByLabelText('API secret'), 'secret_1');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
