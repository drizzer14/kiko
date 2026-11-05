import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { AccountFormDraft } from '@kiko/navigation/types';
import { setBinanceCooldownUntil } from '@kiko/crypto-sync/binance';
import { holdCurrencies } from '@kiko/test-support/held-currencies';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

const mockCreateIfAbsent = jest.fn();
const mockCryptoSync = jest.fn();
const mockFetchAccount = jest.fn();
const mockSaveCredentials = jest.fn();
const mockIsBinanceSyncRunning = jest.fn<boolean, [string]>();
let mockStoredAccountRows: unknown[] = [];

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { table: string }) => ({
    data: query.table === 'accounts' ? mockStoredAccountRows : [],
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
// The mock drives the running state: each case chooses whether a Binance sync of the account is in
// flight. With the check present the join never runs; the real run is held in
// binance-credentials-field.component.running-sync.test.tsx.
jest.mock('@kiko/crypto-sync/run-crypto-sync', () => ({
  isBinanceSyncRunning: (accountId: string) => mockIsBinanceSyncRunning(accountId),
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ getString: async () => '' }));
jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
  clearCredentialsIfWrittenBy: async () => undefined,
}));

const COOLING_TEXT = 'Too many requests to Binance. Try again later.';
const RUNNING_TEXT = 'Kiko is still finishing the last Binance sync. Try again later.';

// The form reopened from its saved draft keeps the id it made for the account, so the test knows
// which id the real Binance field receives.
const connectFromPendingId = async (pendingAccountId: string) => {
  const draft: AccountFormDraft = {
    saved: true,
    name: 'My Crypto',
    icon: null,
    iconIsDirty: false,
    color: null,
    kind: 'crypto',
    currency: 'USD',
    accountCurrency: null,
    initialValue: '',
    bankId: null,
    brokerId: null,
    exchangeId: 'binance',
    pendingAccountId,
  };
  const view = await render(
    <AccountFormScreen
      navigation={asNavigationProp<AccountFormProps['navigation']>(navigationSpy())}
      route={asRouteProp<AccountFormProps['route']>('AccountForm', { draft })}
    />,
  );

  await fireEvent.changeText(view.getByPlaceholderText('Binance API key'), 'api-key-fixture');
  await fireEvent.changeText(view.getByPlaceholderText('Binance API secret'), 'secret-fixture');
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Binance'));
  });

  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsBinanceSyncRunning.mockReturnValue(false);
  mockStoredAccountRows = [];
  holdCurrencies([]);
  mockCreateIfAbsent.mockResolvedValue('new-account-id');
  mockCryptoSync.mockResolvedValue(true);
  mockFetchAccount.mockResolvedValue({ balances: [] });
  mockSaveCredentials.mockResolvedValue(Symbol('saved'));
});

describe('the crypto create form — a retried Binance Connect during a cooldown', () => {
  it('shows the cooling text and creates no row, stores no pair and runs no sync', async () => {
    // An earlier Connect on this id got a 429 and left its row; the form stays in create mode.
    mockStoredAccountRows = [{ id: 'cooldown-form-blocked', bankId: 'binance' }];
    setBinanceCooldownUntil('cooldown-form-blocked', Date.now() + 60_000);

    const view = await connectFromPendingId('cooldown-form-blocked');

    expect(await view.findByText(COOLING_TEXT)).toBeTruthy();
    expect(mockFetchAccount).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCreateIfAbsent).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(view.queryByText('Binance connected')).toBeNull();
  });

  it('creates the row under the pending id and syncs it once no cooldown holds', async () => {
    const view = await connectFromPendingId('cooldown-form-free');

    await waitFor(() => expect(mockCryptoSync).toHaveBeenCalledTimes(1));
    expect(mockCreateIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cooldown-form-free', bankId: 'binance' }),
    );
    expect(mockCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'cooldown-form-free',
    });
    expect(await view.findByText('Binance connected')).toBeTruthy();
    expect(view.queryByText(COOLING_TEXT)).toBeNull();
  });
});

// The form drops a text a Connect throws (a Connect that fails shows only the field's own status),
// so the field's text is the only message the create form can show here.
describe('the crypto create form — a Binance Connect during a running sync', () => {
  it('shows the running text and creates no row, stores no pair and runs no sync', async () => {
    mockIsBinanceSyncRunning.mockImplementation(
      (accountId) => accountId === 'running-form-blocked',
    );

    const view = await connectFromPendingId('running-form-blocked');

    expect(await view.findByText(RUNNING_TEXT)).toBeTruthy();
    expect(mockFetchAccount).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(mockCreateIfAbsent).not.toHaveBeenCalled();
    expect(mockCryptoSync).not.toHaveBeenCalled();
    expect(view.queryByText('Binance connected')).toBeNull();
  });

  it('connects through the pending id when only another account is running', async () => {
    mockIsBinanceSyncRunning.mockImplementation((accountId) => accountId === 'running-form-other');

    const view = await connectFromPendingId('running-form-free');

    expect(await view.findByText('Binance connected')).toBeTruthy();
    expect(view.queryByText(RUNNING_TEXT)).toBeNull();
    expect(mockCryptoSync).toHaveBeenCalledWith({
      providerId: 'binance',
      targetAccountId: 'running-form-free',
    });
  });
});
