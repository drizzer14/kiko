import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { signQuery } from '@kiko/crypto-sync/exchange/signing';
import type { AccountFormDraft } from '@kiko/navigation/types';
import { holdCurrencies } from '@kiko/test-support/held-currencies';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountFormScreen from './account-form.screen';

type AccountFormProps = ComponentProps<typeof AccountFormScreen>;

const mockFetchKeyInfo = jest.fn();
const mockSaveBybitCredentials = jest.fn();
const mockGetStateQuery = jest.fn();
// What a good key reads on each route after the key read; a refusal at the owner check never
// reaches it.
const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ retCode: 0, result: {} }),
}));
const originalFetch = globalThis.fetch;
// The holdings of the pending account, which a first Connect writes.
let mockHoldings: unknown[] = [];

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { table: string }) => {
    const rowsByTable: Record<string, unknown[]> = {
      accounts: [{ id: 'bybit-owner-pending', name: 'My Bybit', kind: 'crypto', bankId: 'bybit' }],
      holdings: mockHoldings,
    };

    return { data: rowsByTable[query.table] ?? [] };
  },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ table: 'settings' }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ table: 'accounts' }),
    exists: async () => false,
    createIfAbsent: async () => 'bybit-owner-pending',
    listQuery: async () => [],
    update: async () => undefined,
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: () => ({ table: 'holdings' }),
    upsertExchangeMany: async () => undefined,
  },
}));
// The stored state of the pending account, which the check of a key of another owner reads.
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: (...args: unknown[]) => mockGetStateQuery(...args),
    patchExchangeState: async () => undefined,
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
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ getString: async () => '' }));
// The real key check runs, so the refusal is the one the provider writes; only the key read and
// the Keychain are replaced.
jest.mock('@kiko/crypto-sync/bybit/bybit.client', () => ({
  ...jest.requireActual('@kiko/crypto-sync/bybit/bybit.client'),
  fetchKeyInfo: (...args: unknown[]) => mockFetchKeyInfo(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () => ({
  saveBybitCredentials: (...args: unknown[]) => mockSaveBybitCredentials(...args),
  readBybitCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
  clearBybitCredentials: async () => undefined,
  clearBybitCredentialsIfWrittenBy: async () => undefined,
}));

const PENDING_ID = 'bybit-owner-pending';
const FIRST_USER_ID = '424242424242';
const SECOND_USER_ID = '737373737373';

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

const storedOwnerOf = (userId: string): void => {
  mockGetStateQuery.mockResolvedValue([
    {
      exchangeState: JSON.stringify({
        version: 1,
        walks: {},
        keyOwner: signQuery(PENDING_ID, userId),
      }),
    },
  ]);
};

beforeEach(() => {
  jest.clearAllMocks();
  holdCurrencies([]);
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockSaveBybitCredentials.mockResolvedValue(Symbol('saved'));
  storedOwnerOf(FIRST_USER_ID);
  mockHoldings = [{ id: 'first-holding', metadata: { bybitAsset: 'BTC:unified', syncedAt: 1 } }];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// The state stores the owner of the key connected first. The first Connect of the form left it
// there, with the Bybit holding it wrote; the check runs only while the account keeps one.
describe('the crypto create form, a second Bybit key after the first one connected', () => {
  it('refuses the key of another Bybit account, with no read and no Keychain write', async () => {
    mockFetchKeyInfo.mockResolvedValue({ readOnly: 1, isMaster: true, userId: SECOND_USER_ID });

    const view = await connectOnBybitForm();

    expect(await view.findByText(i18n.t('accountDetail.bybitKeyOtherAccount'))).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSaveBybitCredentials).not.toHaveBeenCalled();
  });

  it.each([
    ['the key of the same Bybit account', FIRST_USER_ID, () => storedOwnerOf(FIRST_USER_ID)],
    ['a key with no stored owner', SECOND_USER_ID, () => mockGetStateQuery.mockResolvedValue([])],
  ])('goes on to read the routes for %s', async (_case, userId, seedState) => {
    seedState();
    mockFetchKeyInfo.mockResolvedValue({ readOnly: 1, isMaster: true, userId });

    const view = await connectOnBybitForm();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(view.queryByText(i18n.t('accountDetail.bybitKeyOtherAccount'))).toBeNull();
  });

  it('goes on to read the routes when the first key stored an owner and wrote no holding', async () => {
    mockHoldings = [];
    mockFetchKeyInfo.mockResolvedValue({ readOnly: 1, isMaster: true, userId: SECOND_USER_ID });

    const view = await connectOnBybitForm();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(view.queryByText(i18n.t('accountDetail.bybitKeyOtherAccount'))).toBeNull();
  });
});
