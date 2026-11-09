import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountFormDraft } from '@kiko/navigation/types';
import { holdCurrencies } from '@kiko/test-support/held-currencies';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

const mockCreateIfAbsent = jest.fn();
const mockFetchKeyInfo = jest.fn();
const mockSaveBybitCredentials = jest.fn();
const mockClearBybitCredentialsIfWrittenBy = jest.fn();
const mockUpdateAccount = jest.fn();
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
    listQuery: async () => mockStoredAccountRows,
    update: (...args: unknown[]) => mockUpdateAccount(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { listByAccountQuery: async () => [], upsertExchangeMany: async () => undefined },
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: async () => [], patchExchangeState: async () => undefined },
}));
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/sync/refresh-market-data', () =>
  require('@kiko/test-support/account-form-test-support').refreshMarketDataModule(jest.fn()),
);
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ getString: async () => '' }));
// The real provider runs: only the answers of Bybit and the Keychain are replaced, so the text a
// refusal reaches the form with is the one the provider writes.
jest.mock('@kiko/crypto-sync/bybit/bybit.client', () => ({
  ...jest.requireActual('@kiko/crypto-sync/bybit/bybit.client'),
  fetchKeyInfo: (...args: unknown[]) => mockFetchKeyInfo(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.key-check', () => ({
  bybitKeyRefusalOf: async () => undefined,
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () => ({
  saveBybitCredentials: (...args: unknown[]) => mockSaveBybitCredentials(...args),
  readBybitCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
  clearBybitCredentials: async () => undefined,
  clearBybitCredentialsIfWrittenBy: (...args: unknown[]) =>
    mockClearBybitCredentialsIfWrittenBy(...args),
}));

const PENDING_ID = 'bybit-form-pending';
const GENERIC_CONNECT_FAILURE = 'Bybit request failed.';

const connectOnBybitForm = async () => {
  const draft: AccountFormDraft = {
    saved: true,
    name: 'My Bybit',
    icon: null,
    iconIsDirty: false,
    color: null,
    kind: 'crypto',
    currency: 'USD',
    accountCurrency: null,
    initialValue: '',
    bankId: null,
    brokerId: null,
    exchangeId: 'bybit',
    pendingAccountId: PENDING_ID,
  };
  const view = await render(
    <AccountFormScreen
      navigation={asNavigationProp<AccountFormProps['navigation']>(navigationSpy())}
      route={asRouteProp<AccountFormProps['route']>('AccountForm', { draft })}
    />,
  );

  await fireEvent.changeText(view.getByPlaceholderText('Bybit API key'), 'api-key-fixture');
  await fireEvent.changeText(view.getByPlaceholderText('Bybit API secret'), 'secret-fixture');
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Bybit'));
  });

  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStoredAccountRows = [{ id: PENDING_ID, name: 'My Bybit', kind: 'crypto', bankId: 'bybit' }];
  holdCurrencies([]);
  mockCreateIfAbsent.mockResolvedValue(PENDING_ID);
  mockUpdateAccount.mockResolvedValue(undefined);
  mockSaveBybitCredentials.mockResolvedValue(Symbol('saved'));
});

describe('the crypto create form — the first Connect of a Bybit key', () => {
  it('a refusal of the first Connect shows the text of that refusal in the form, and not the generic text', async () => {
    const { BybitRefusalError } = jest.requireActual('@kiko/crypto-sync/bybit/bybit.client');
    mockFetchKeyInfo.mockRejectedValue(new BybitRefusalError('expired', 33004));

    const view = await connectOnBybitForm();

    expect(await view.findByText(i18n.t('accountDetail.bybitKeyRefusedExpired'))).toBeTruthy();
    expect(view.queryByText(GENERIC_CONNECT_FAILURE)).toBeNull();
    expect(view.queryByText('Bybit connected')).toBeNull();
  });

  it("shows a rate refusal's own text, which names the wait", async () => {
    const { BybitRateLimitError } = jest.requireActual('@kiko/crypto-sync/bybit/bybit.client');
    mockFetchKeyInfo.mockRejectedValue(new BybitRateLimitError(403, 600_000));

    const view = await connectOnBybitForm();

    expect(await view.findByText(i18n.t('accountDetail.bybitForbidden'))).toBeTruthy();
  });

  it('creates the row under the pending id before the sync that the refusal ends', async () => {
    const { BybitRefusalError } = jest.requireActual('@kiko/crypto-sync/bybit/bybit.client');
    mockFetchKeyInfo.mockRejectedValue(new BybitRefusalError('expired', 33004));

    await connectOnBybitForm();

    await waitFor(() => expect(mockFetchKeyInfo).toHaveBeenCalledTimes(1));
    expect(mockCreateIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ id: PENDING_ID, bankId: 'bybit' }),
    );
  });
});
