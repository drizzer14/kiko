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
const mockMonobankSync = jest.fn();
const mockFetchClientInfo = jest.fn();
const mockSaveToken = jest.fn();
const mockIsMonobankSyncRunning = jest.fn<boolean, [string]>();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [] }),
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
  require('@kiko/test-support/account-form-test-support').idleSyncModule(
    'useSync',
    (...args: unknown[]) => mockMonobankSync(...args),
  ),
);
jest.mock('@kiko/sync/use-crypto-sync', () =>
  require('@kiko/test-support/account-form-test-support').idleSyncModule(
    'useCryptoSync',
    jest.fn(),
  ),
);
// The mock drives the running state: each case chooses whether a sync of the account is in flight.
// With the check present the join never runs; the `runSync` join tests in
// `src/monobank/sync/sync.test.ts` pin it.
jest.mock('@kiko/monobank/sync', () => ({
  isMonobankSyncRunning: (accountId: string) => mockIsMonobankSyncRunning(accountId),
}));
jest.mock('@kiko/monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));

const RUNNING_TEXT = i18n.t('accountDetail.monobankSyncStillRunning');

// The form reopened from its saved draft keeps the id it made for the account, so the test knows
// which id the real Monobank field receives.
const connectFromPendingId = async (pendingAccountId: string) => {
  const draft: AccountFormDraft = {
    saved: true,
    name: 'My Bank',
    icon: null,
    iconIsDirty: false,
    color: null,
    kind: 'bank',
    currency: 'UAH',
    accountCurrency: null,
    initialValue: '',
    bankId: 'monobank',
    brokerId: null,
    exchangeId: null,
    pendingAccountId,
  };
  const view = await render(
    <AccountFormScreen
      navigation={asNavigationProp<AccountFormProps['navigation']>(navigationSpy())}
      route={asRouteProp<AccountFormProps['route']>('AccountForm', { draft })}
    />,
  );

  await fireEvent.changeText(
    view.getByPlaceholderText(i18n.t('accountDetail.monobankTokenPlaceholder')),
    'tok-123',
  );
  await act(async () => {
    await fireEvent.press(view.getByText(i18n.t('accountDetail.connectMonobank')));
  });

  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMonobankSyncRunning.mockReturnValue(false);
  holdCurrencies([]);
  mockCreateIfAbsent.mockResolvedValue('new-account-id');
  mockMonobankSync.mockResolvedValue(true);
  mockFetchClientInfo.mockResolvedValue({ name: 'Ada' });
  mockSaveToken.mockResolvedValue(undefined);
});

// The form drops a text a Connect throws (a Connect that fails shows only the field's own status),
// so the field's text is the only message the create form can show here.
describe('the bank create form — a Monobank Connect during a running sync', () => {
  it('shows the running text and creates no row, stores no token and runs no sync', async () => {
    mockIsMonobankSyncRunning.mockImplementation(
      (accountId) => accountId === 'running-form-blocked',
    );

    const view = await connectFromPendingId('running-form-blocked');

    expect(await view.findByText(RUNNING_TEXT)).toBeTruthy();
    expect(mockFetchClientInfo).not.toHaveBeenCalled();
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockCreateIfAbsent).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
    expect(view.queryByText(i18n.t('accountDetail.connectedAs', { name: 'Ada' }))).toBeNull();
  });

  it('connects through the pending id when only another account is running', async () => {
    mockIsMonobankSyncRunning.mockImplementation((accountId) => accountId === 'running-form-other');

    const view = await connectFromPendingId('running-form-free');

    expect(
      await view.findByText(i18n.t('accountDetail.connectedAs', { name: 'Ada' })),
    ).toBeTruthy();
    expect(view.queryByText(RUNNING_TEXT)).toBeNull();
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledWith('running-form-free'));
    expect(mockSaveToken).toHaveBeenCalledWith('running-form-free', 'tok-123');
  });
});
