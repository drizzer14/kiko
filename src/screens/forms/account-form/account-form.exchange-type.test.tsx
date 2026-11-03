import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  asNavigationProp,
  asRouteProp,
  type NavigationSpy,
  navigationSpy,
} from '@kiko/test-support/navigation-props';
import type { AccountFormDraft } from '@kiko/navigation/types';
import { pressSave } from '@kiko/test-support/form-header-items';
import { holdCurrencies } from '@kiko/test-support/held-currencies';
import { selectExchange, selectKind } from '@kiko/test-support/account-form-test-support';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

type RouteParams = AccountFormProps['route']['params'];

const mockSaveFormAccount = jest.fn();
const mockCreateIfAbsent = jest.fn();
const mockCryptoSync = jest.fn();
const mockClearCredentialsIfWrittenBy = jest.fn();
// What each mocked field's Connect answered, in call order.
const mockConnectResults: boolean[] = [];

let mockAccounts: unknown[] = [];

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockAccounts }),
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
  },
}));
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/sync/refresh-market-data', () =>
  require('@kiko/test-support/account-form-test-support').refreshMarketDataModule(jest.fn()),
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
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: jest.fn(),
  clearCredentialsIfWrittenBy: (...args: unknown[]) => mockClearCredentialsIfWrittenBy(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({ fetchAccount: jest.fn() }));
// Each field is one pressable that fires the screen's Connect and records its answer: which field
// the picked entry mounts, and what the screen does on that Connect, is what is under test.
jest.mock('@kiko/design-system/components/wallet-address-field', () => {
  const { Pressable, Text } = require('react-native');

  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (address: string) => Promise<boolean> }) => (
      <Pressable
        accessibilityLabel="wallet-field"
        onPress={async () => mockConnectResults.push(await onConnect('bc1qwallet'))}
      >
        <Text>wallet field</Text>
      </Pressable>
    ),
  };
});
jest.mock('@kiko/design-system/components/binance-credentials-field', () => {
  const { Pressable, Text } = require('react-native');

  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (stored: symbol) => Promise<boolean> }) => (
      <Pressable
        accessibilityLabel="binance-field"
        onPress={async () => mockConnectResults.push(await onConnect(Symbol('write')))}
      >
        <Text>binance field</Text>
      </Pressable>
    ),
  };
});

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

// The create form on the Crypto kind with a name typed, where every crypto test starts.
const renderCryptoForm = async (): Promise<Rendered> => {
  const view = await renderForm();

  await fireEvent.changeText(view.getByLabelText('Name'), 'My Crypto');
  await selectKind(view.getByTestId, 'crypto');

  return view;
};

const isDisabled = (element: { props: { accessibilityState?: { disabled?: boolean } } }): boolean =>
  Boolean(element.props.accessibilityState?.disabled);

beforeEach(() => {
  jest.clearAllMocks();
  mockAccounts = [];
  mockConnectResults.length = 0;
  holdCurrencies([]);
  mockSaveFormAccount.mockResolvedValue('new-account-id');
  mockCreateIfAbsent.mockResolvedValue('new-account-id');
  mockCryptoSync.mockResolvedValue(true);
  mockClearCredentialsIfWrittenBy.mockResolvedValue(undefined);
});

describe('the exchange or wallet picker on the crypto create form', () => {
  it('shows the exchange picker and no source toggle on the crypto create', async () => {
    const { getByTestId, queryByText, queryByLabelText } = await renderCryptoForm();

    expect(getByTestId('account-exchange-type-field')).toHaveTextContent(
      'Select an exchange or wallet',
    );
    expect(queryByText('Source')).toBeNull();
    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it('shows the Binance key field once Binance is picked', async () => {
    const { getByTestId, getByLabelText, queryByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'binance');

    expect(getByTestId('account-exchange-type-field')).toHaveTextContent('Binance');
    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('shows the wallet address field once Bitcoin wallet is picked', async () => {
    const { getByTestId, getByLabelText, queryByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'btc_wallet');

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it('shows no connect field for Other exchange or wallet', async () => {
    const { getByTestId, queryByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'other');

    expect(getByTestId('account-exchange-type-field')).toHaveTextContent(
      'Other exchange or wallet',
    );
    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it("saves the picked catalog id as the crypto account's bank id", async () => {
    const view = await renderCryptoForm();

    await selectExchange(view.getByTestId, 'binance');
    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'crypto', bankId: 'binance' }),
    );
  });

  it('creates an unconnected crypto account with no bank id when nothing is picked', async () => {
    const view = await renderCryptoForm();

    await pressSave(view.navigation.setOptions);

    expect(mockSaveFormAccount).toHaveBeenCalledTimes(1);
    expect(mockSaveFormAccount).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'crypto', bankId: null }),
    );
    expect(mockCreateIfAbsent).not.toHaveBeenCalled();
  });

  it('locks the exchange picker once a Connect has started the row', async () => {
    const { getByTestId, getByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'binance');
    expect(isDisabled(getByTestId('account-exchange-type-field'))).toBe(false);

    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(isDisabled(getByTestId('account-exchange-type-field'))).toBe(true));
  });

  it('clears the Binance key pair when the account row cannot be inserted after picking Binance', async () => {
    mockCreateIfAbsent.mockRejectedValueOnce(new Error('db locked'));
    const { getByTestId, getByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'binance');
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledTimes(1));
    expect(mockClearCredentialsIfWrittenBy).toHaveBeenCalledWith(
      (mockCreateIfAbsent.mock.calls[0][0] as { id: string }).id,
      expect.any(Symbol),
    );
    expect(mockConnectResults).toEqual([false]);
    expect(mockCryptoSync).not.toHaveBeenCalled();
  });

  it('reports not connected and inserts no row when the wallet Connect cannot insert the row', async () => {
    mockCreateIfAbsent.mockRejectedValueOnce(new Error('db locked'));
    const { getByTestId, getByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'btc_wallet');
    await fireEvent.press(getByLabelText('wallet-field'));

    await waitFor(() => expect(mockConnectResults).toEqual([false]));
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(mockSaveFormAccount).not.toHaveBeenCalled();
    expect(isDisabled(getByTestId('account-kind-field'))).toBe(false);
    expect(isDisabled(getByTestId('account-exchange-type-field'))).toBe(false);
  });

  it('inserts the row with the picked bank id before the Binance connect runs', async () => {
    const { getByTestId, getByLabelText } = await renderCryptoForm();

    await selectExchange(getByTestId, 'binance');
    await fireEvent.press(getByLabelText('binance-field'));

    await waitFor(() => expect(mockCryptoSync).toHaveBeenCalledTimes(1));
    expect(mockCreateIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'crypto', bankId: 'binance' }),
    );
    expect(mockCreateIfAbsent.mock.invocationCallOrder[0]).toBeLessThan(
      mockCryptoSync.mock.invocationCallOrder[0],
    );
    expect(mockCryptoSync).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'binance' }));
  });

  it('shows no exchange picker on the crypto edit form', async () => {
    mockAccounts = [
      {
        id: 'acc-1',
        name: 'My Crypto',
        kind: 'crypto',
        icon: null,
        color: null,
        bankId: 'binance',
        institution: 'binance',
        currency: null,
      },
    ];
    const { getByTestId, queryByTestId, queryByLabelText } = await renderForm({
      accountId: 'acc-1',
    });

    await waitFor(() => expect(getByTestId('account-kind-field')).toHaveTextContent('Crypto'));

    expect(queryByTestId('account-exchange-type-field')).toBeNull();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  describe('a saved draft', () => {
    const draftOf = (exchangeId: unknown): AccountFormDraft =>
      ({
        saved: true,
        name: 'My Crypto',
        icon: null,
        iconIsDirty: false,
        color: null,
        kind: 'crypto',
        currency: 'UAH',
        accountCurrency: null,
        initialValue: '',
        bankId: null,
        brokerId: null,
        exchangeId,
        pendingAccountId: 'pending-1',
      }) as AccountFormDraft;

    it('opens on the exchange it holds, with that exchange field mounted', async () => {
      const { getByTestId, getByLabelText } = await renderForm({ draft: draftOf('btc_wallet') });

      expect(getByTestId('account-exchange-type-field')).toHaveTextContent(/^Bitcoin wallet$/);
      expect(getByLabelText('wallet-field')).toBeTruthy();
    });

    it('opens on no pick when it was saved before the picker existed', async () => {
      const { getByTestId, queryByLabelText } = await renderForm({ draft: draftOf(undefined) });

      expect(getByTestId('account-exchange-type-field')).toHaveTextContent(
        'Select an exchange or wallet',
      );
      expect(queryByLabelText('wallet-field')).toBeNull();
    });

    it('writes the picked exchange into the draft on blur', async () => {
      const view = await renderCryptoForm();

      await selectExchange(view.getByTestId, 'binance');
      await fireEvent(view.getByLabelText('Name'), 'blur');

      expect(view.navigation.setParams).toHaveBeenCalledWith({
        draft: expect.objectContaining({ kind: 'crypto', exchangeId: 'binance' }),
      });
    });
  });
});
