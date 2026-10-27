import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
  paramsAfter,
} from '@kiko/test-support/navigation-props';
import type { accountsRepo } from '@kiko/accounts';
import { pressSave } from '@kiko/test-support/form-header-items';
import { holdCurrencies } from '@kiko/test-support/held-currencies';
import { selectExchange, selectKind } from '@kiko/test-support/account-form-test-support';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

type RouteParams = AccountFormProps['route']['params'];

const HINT =
  'The account card shows its total in this currency. Holdings keep their own currencies.';

const mockSaveFormAccount = jest.fn();
const mockCreateIfAbsent = jest.fn();
const mockCreateCashAccount = jest.fn<
  ReturnType<typeof accountsRepo.createCashAccount>,
  Parameters<typeof accountsRepo.createCashAccount>
>();
const mockUpdate = jest.fn();
const mockSetIcon = jest.fn();
const mockCryptoSync = jest.fn();
const mockRefreshMarketData = jest.fn();
// Every call to a holdings or transactions repo method, whatever its name: an account's currency
// edit must reach neither.
const mockMoneyRepoCall = jest.fn();

// The rows the screen's two live queries answer with, told apart by the table each mocked query
// names. `mock`-prefixed so the hoisted factories may close over them.
let mockAccounts: unknown[] = [];
let mockSettings: unknown[] = [];

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { table: string }) => ({
    data: query.table === 'settings' ? mockSettings : mockAccounts,
  }),
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ table: 'settings' }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ table: 'accounts' }),
    exists: async () => false,
    createIfAbsent: (...args: unknown[]) => mockCreateIfAbsent(...args),
    saveFormAccount: (...args: unknown[]) => mockSaveFormAccount(...args),
    createCashAccount: (...args: Parameters<typeof accountsRepo.createCashAccount>) =>
      mockCreateCashAccount(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    setIcon: (...args: unknown[]) => mockSetIcon(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: new Proxy({}, { get: () => mockMoneyRepoCall }),
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: new Proxy({}, { get: () => mockMoneyRepoCall }),
}));
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/sync/refresh-market-data', () =>
  require('@kiko/test-support/account-form-test-support').refreshMarketDataModule(
    (...args: unknown[]) => mockRefreshMarketData(...args),
  ),
);
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');
jest.mock('@kiko/sync/use-sync', () =>
  require('@kiko/test-support/account-form-test-support').idleSyncModule('useSync', jest.fn()),
);
jest.mock('@kiko/sync/use-crypto-sync', () =>
  require('@kiko/test-support/account-form-test-support').idleSyncModule(
    'useCryptoSync',
    (...args: unknown[]) => mockCryptoSync(...args),
  ),
);
// The shared crypto sync form owns its fields' inputs and Keychain writes. Here the wallet field
// is one pressable that fires the screen's Connect, and the Binance field renders nothing.
jest.mock('@kiko/design-system/components/wallet-address-field', () => {
  const { Pressable, Text } = require('react-native');

  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (address: string) => Promise<boolean> }) => (
      <Pressable accessibilityLabel="wallet-field" onPress={() => onConnect('bc1qwallet')}>
        <Text>wallet field</Text>
      </Pressable>
    ),
  };
});
jest.mock('@kiko/design-system/components/binance-credentials-field', () => ({
  __esModule: true,
  default: () => null,
}));

type Rendered = Awaited<ReturnType<typeof render>> & { navigation: NavigationSpy };

const renderForm = async (params: RouteParams = {}): Promise<Rendered> => {
  const navigation = navigationSpy();
  const view = await render(
    <AccountFormScreen
      navigation={asNavigationProp<AccountFormProps['navigation']>(navigation)}
      route={asRouteProp<AccountFormProps['route']>('AccountForm', params)}
    />,
  );

  return { ...view, navigation };
};

const pickCurrency = async (view: Rendered, code: string): Promise<void> => {
  await fireEvent.press(view.getByTestId('account-currency-field'));
  await fireEvent.changeText(view.getByPlaceholderText('Search by code or name'), code);
  await fireEvent.press(view.getByTestId(`currency-option-${code}`));
};

const pickOtherBank = async (getByTestId: Rendered['getByTestId']): Promise<void> => {
  await fireEvent.press(getByTestId('account-bank-type-field'));
  await fireEvent.press(getByTestId('bank-type-option-other'));
};

// A named bank account on the "Other bank" pick, where a bank Save test starts.
const renderBankForm = async (): Promise<Rendered> => {
  const view = await renderForm();

  await fireEvent.changeText(view.getByLabelText('Name'), 'Savings');
  await pickOtherBank(view.getByTestId);

  return view;
};

const storedAccount = (overrides: object) => ({
  id: 'acc-1',
  name: 'Stored',
  kind: 'bank',
  icon: null,
  color: null,
  bankId: null,
  institution: null,
  currency: 'UAH',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAccounts = [];
  mockSettings = [{ baseCurrency: 'USD' }];
  holdCurrencies([]);
  mockSaveFormAccount.mockResolvedValue('new-account-id');
  mockCreateIfAbsent.mockResolvedValue('new-account-id');
  mockCreateCashAccount.mockResolvedValue({
    accountId: 'new-cash-account-id',
    holdingId: 'new-cash-holding-id',
  });
  mockUpdate.mockResolvedValue(undefined);
  mockSetIcon.mockResolvedValue(undefined);
  mockCryptoSync.mockResolvedValue(true);
});

describe('the account currency field on a create form', () => {
  it('shows the base currency from settings until the user picks one', async () => {
    const { getByTestId } = await renderBankForm();

    expect(getByTestId('account-currency-field')).toHaveTextContent('US Dollar', { exact: false });
  });

  it('saves the picked currency with the account', async () => {
    const view = await renderBankForm();

    await pickCurrency(view, 'EUR');

    expect(view.getByTestId('account-currency-field')).toHaveTextContent('Euro', { exact: false });

    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', currency: 'EUR' }),
    );
  });

  it('saves null, never the base it shows, when the user picked nothing', async () => {
    const view = await renderBankForm();

    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', currency: null }),
    );
  });

  it('shows the settings default while the settings row is not read, and still saves null', async () => {
    mockSettings = [];
    const view = await renderBankForm();

    expect(view.getByTestId('account-currency-field')).toHaveTextContent('Ukrainian Hryvnia', {
      exact: false,
    });

    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bank', currency: null }),
    );
  });

  it('offers the coins beside the fiat currencies', async () => {
    const view = await renderBankForm();

    await pickCurrency(view, 'BTC');
    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(expect.objectContaining({ currency: 'BTC' }));
  });

  it('keeps a pick made after Connect: Connect inserts with null, Save writes the pick', async () => {
    const view = await renderForm();
    await fireEvent.changeText(view.getByLabelText('Name'), 'Wallet');
    await selectKind(view.getByTestId, 'crypto');
    await selectExchange(view.getByTestId, 'btc_wallet');

    await fireEvent.press(view.getByLabelText('wallet-field'));
    await pickCurrency(view, 'BTC');
    await pressSave(view.navigation.setOptions);

    expect(mockCreateIfAbsent).toHaveBeenCalledTimes(1);
    expect(mockCreateIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'crypto', currency: null }),
    );
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'crypto', currency: 'BTC' }),
    );
    expect(mockCreateIfAbsent.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveFormAccount.mock.invocationCallOrder[0],
    );
  });

  it('hands a pick made before Connect to the Connect insert', async () => {
    const view = await renderForm();
    await fireEvent.changeText(view.getByLabelText('Name'), 'Wallet');
    await selectKind(view.getByTestId, 'crypto');
    await selectExchange(view.getByTestId, 'btc_wallet');

    await pickCurrency(view, 'EUR');
    await fireEvent.press(view.getByLabelText('wallet-field'));

    expect(mockCreateIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'crypto', currency: 'EUR' }),
    );
  });

  it('shows the base again when the kind switches from cash to bank, not the cash pick', async () => {
    const view = await renderForm();
    await selectKind(view.getByTestId, 'cash');
    await pickCurrency(view, 'EUR');

    expect(view.getByTestId('account-currency-field')).toHaveTextContent('Euro', { exact: false });

    await selectKind(view.getByTestId, 'bank');

    expect(view.getByTestId('account-currency-field')).toHaveTextContent('US Dollar', {
      exact: false,
    });
  });

  describe('a cash account', () => {
    const renderCashForm = async (): Promise<Rendered> => {
      const view = await renderForm();

      await fireEvent.changeText(view.getByLabelText('Name'), 'Wallet');
      await selectKind(view.getByTestId, 'cash');

      return view;
    };

    it('has exactly one currency field, so the account and its cash cannot drift apart', async () => {
      const { getAllByTestId } = await renderCashForm();

      expect(getAllByTestId('account-currency-field')).toHaveLength(1);
    });

    it('sends the one pick to createCashAccount and never to the shared create path', async () => {
      const view = await renderCashForm();
      await fireEvent.changeText(view.getByLabelText('Initial value'), '250.50');

      await pickCurrency(view, 'EUR');
      await pressSave(view.navigation.setOptions);

      expect(mockCreateCashAccount).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'EUR', initialBalance: Money.of('EUR', 25050) }),
      );
      expect(mockSaveFormAccount).not.toHaveBeenCalled();
    });

    it('offers the fiat currencies only, as the cash holding can hold no coin', async () => {
      const view = await renderCashForm();

      await fireEvent.press(view.getByTestId('account-currency-field'));
      await fireEvent.changeText(view.getByPlaceholderText('Search by code or name'), 'BTC');

      expect(view.queryByTestId('currency-option-BTC')).toBeNull();
    });
  });
});

describe('the hint under the account currency field', () => {
  it.each(['bank', 'crypto', 'metals', 'broker'] as const)(
    'shows on a new %s account',
    async (kind) => {
      const view = await renderForm();

      await selectKind(view.getByTestId, kind);

      expect(view.getByText(HINT)).toBeTruthy();
    },
  );

  it('does not show on a new cash account', async () => {
    const view = await renderForm();

    await selectKind(view.getByTestId, 'cash');

    expect(view.queryByText(HINT)).toBeNull();
  });

  it('shows on the edit of a cash account', async () => {
    mockAccounts = [storedAccount({ kind: 'cash' })];

    const { getByText } = await renderForm({ accountId: 'acc-1' });

    expect(getByText(HINT)).toBeTruthy();
  });
});

describe('the account currency field on an edit form', () => {
  it('shows the stored currency, not the base', async () => {
    mockAccounts = [storedAccount({ currency: 'EUR' })];

    const { getByTestId } = await renderForm({ accountId: 'acc-1' });

    expect(getByTestId('account-currency-field')).toHaveTextContent('Euro', { exact: false });
  });

  it('puts the new currency in the update patch of a cash account and touches no money row', async () => {
    mockAccounts = [storedAccount({ kind: 'cash', name: 'Wallet', currency: 'UAH' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith('acc-1', {
      name: 'Wallet',
      color: null,
      currency: 'EUR',
    });
    expect(mockMoneyRepoCall).not.toHaveBeenCalled();
    expect(mockCreateCashAccount).not.toHaveBeenCalled();
    expect(mockSaveFormAccount).not.toHaveBeenCalled();
  });

  it('leaves currency out of the patch when the user did not change it', async () => {
    mockAccounts = [storedAccount({ currency: 'EUR' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await fireEvent.changeText(view.getByLabelText('Name'), 'Renamed');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', { name: 'Renamed', color: null });
  });

  it('leaves currency out of the patch when the pick is the stored currency again', async () => {
    mockAccounts = [storedAccount({ currency: 'EUR' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'USD');
    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', { name: 'Stored', color: null });
  });

  it('is enabled on a synced bank, and saves its pick', async () => {
    mockAccounts = [storedAccount({ institution: 'monobank', bankId: 'monobank' })];
    const view = await renderForm({ accountId: 'acc-1' });

    expect(
      view.getByTestId('account-currency-field').props.accessibilityState.disabled,
    ).toBeFalsy();

    await pickCurrency(view, 'GBP');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate).toHaveBeenCalledWith('acc-1', {
      name: 'Stored',
      color: null,
      currency: 'GBP',
    });
  });

  describe.each(['property', 'debt'] as const)('an implicit %s account', (kind) => {
    it('shows the stored currency in the field, with the hint', async () => {
      mockAccounts = [storedAccount({ kind, currency: 'EUR' })];

      const { getByTestId, getByText } = await renderForm({ accountId: 'acc-1' });

      expect(getByTestId('account-currency-field')).toHaveTextContent('Euro', { exact: false });
      expect(getByText(HINT)).toBeTruthy();
    });

    it('saves a changed currency in the update patch', async () => {
      mockAccounts = [storedAccount({ kind, currency: 'UAH' })];
      const view = await renderForm({ accountId: 'acc-1' });

      await pickCurrency(view, 'USD');
      await pressSave(view.navigation.setOptions);

      expect(mockUpdate).toHaveBeenCalledWith(
        'acc-1',
        expect.objectContaining({ currency: 'USD' }),
      );
      expect(mockMoneyRepoCall).not.toHaveBeenCalled();
    });

    it('leaves currency out of the patch when the user did not change it', async () => {
      mockAccounts = [storedAccount({ kind, currency: 'EUR' })];
      const view = await renderForm({ accountId: 'acc-1' });

      await pressSave(view.navigation.setOptions);

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('currency');
    });
  });
});

describe('the market data refresh after an account currency pick', () => {
  const REFRESH = { throttled: false, metals: false };

  const renderCashForm = async (): Promise<Rendered> => {
    const view = await renderForm();

    await fireEvent.changeText(view.getByLabelText('Name'), 'Wallet');
    await selectKind(view.getByTestId, 'cash');
    await fireEvent.changeText(view.getByLabelText('Initial value'), '10');

    return view;
  };

  it('runs once, unthrottled, after an edit changes the currency', async () => {
    mockAccounts = [storedAccount({ kind: 'property', currency: 'UAH' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'BTC');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith(REFRESH);
  });

  it('runs after the currency write commits', async () => {
    mockAccounts = [storedAccount({ currency: 'UAH' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshMarketData.mock.invocationCallOrder[0],
    );
  });

  it('still runs when only the icon write after a committed currency change fails', async () => {
    mockAccounts = [storedAccount({ currency: 'UAH' })];
    mockSetIcon.mockRejectedValue(new Error('disk full'));
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
  });

  it('does not run when an edit leaves the currency alone', async () => {
    mockAccounts = [storedAccount({ currency: 'EUR' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await fireEvent.changeText(view.getByLabelText('Name'), 'Renamed');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });

  it('does not run when the pick is the stored currency again', async () => {
    mockAccounts = [storedAccount({ currency: 'EUR' })];
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'USD');
    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });

  it('does not run when the update throws', async () => {
    mockAccounts = [storedAccount({ currency: 'UAH' })];
    mockUpdate.mockRejectedValue(new Error('disk full'));
    const view = await renderForm({ accountId: 'acc-1' });

    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });

  it('runs once after a create with a picked currency', async () => {
    const view = await renderBankForm();

    await pickCurrency(view, 'BTC');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith(REFRESH);
  });

  it('does not run after a create that picked nothing', async () => {
    const view = await renderBankForm();

    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });

  it('does not run when the create throws', async () => {
    mockSaveFormAccount.mockRejectedValue(new Error('disk full'));
    const view = await renderBankForm();

    await pickCurrency(view, 'BTC');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });

  it('runs once after a cash create, whose one pick is also its holding currency', async () => {
    const view = await renderCashForm();

    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).toHaveBeenCalledTimes(1);
    expect(mockRefreshMarketData).toHaveBeenCalledWith(REFRESH);
  });

  it('does not run when the cash create throws', async () => {
    mockCreateCashAccount.mockRejectedValue(new Error('disk full'));
    const view = await renderCashForm();

    await pickCurrency(view, 'EUR');
    await pressSave(view.navigation.setOptions);

    expect(mockRefreshMarketData).not.toHaveBeenCalled();
  });
});

describe('the account currency in the form draft', () => {
  it('comes back after a remount, and Save writes it', async () => {
    const first = await renderBankForm();
    await pickCurrency(first, 'EUR');
    await fireEvent(first.getByLabelText('Name'), 'blur');
    await first.unmount();

    const second = await renderForm(paramsAfter(first.navigation, {}) as RouteParams);

    expect(second.getByTestId('account-currency-field')).toHaveTextContent('Euro', {
      exact: false,
    });

    await pressSave(second.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR' }));
  });

  it('keeps an untouched field null, so the shown base keeps following settings', async () => {
    const first = await renderBankForm();
    await fireEvent(first.getByLabelText('Name'), 'blur');

    const [[{ draft }]] = first.navigation.setParams.mock.calls;

    expect(draft).toEqual(expect.objectContaining({ accountCurrency: null }));
  });

  it('reads null from a saved draft that has no such key', async () => {
    const draftWithoutKey = {
      saved: true,
      name: 'Savings',
      icon: null,
      iconIsDirty: false,
      color: null,
      kind: 'bank',
      currency: 'UAH',
      initialValue: '',
      bankId: 'other',
      brokerId: null,
      pendingAccountId: 'pending-1',
    };
    const view = await renderForm({ draft: draftWithoutKey } as unknown as RouteParams);

    expect(view.getByTestId('account-currency-field')).toHaveTextContent('US Dollar', {
      exact: false,
    });

    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(expect.objectContaining({ currency: null }));
  });
});
