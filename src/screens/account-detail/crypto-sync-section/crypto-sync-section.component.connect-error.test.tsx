import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountRow } from '@kiko/db';

import CryptoSyncSection from './crypto-sync-section.component';

const mockRunCryptoSync = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false }),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: async () => undefined,
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync/refresh-market-data', () =>
  require('@kiko/test-support/account-form-test-support').refreshMarketDataModule(jest.fn()),
);
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: async () => undefined,
}));
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({ getString: async () => '' }));
// The real sync action runs, so the error line is the one a failed Connect leaves in the section;
// only the run it wraps is replaced.
jest.mock('@kiko/crypto-sync/run-crypto-sync', () => ({
  ...jest.requireActual('@kiko/crypto-sync/run-crypto-sync'),
  runCryptoSync: (...args: unknown[]) => mockRunCryptoSync(...args),
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.key-check', () => ({
  bybitKeyRefusalOf: async () => undefined,
}));
jest.mock('@kiko/crypto-sync/bybit/bybit.credentials', () => ({
  saveBybitCredentials: async () => Symbol('saved'),
  readBybitCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
  clearBybitCredentials: async () => undefined,
  clearBybitCredentialsIfWrittenBy: async () => undefined,
}));

const REFUSAL = (): string => i18n.t('accountDetail.bybitKeyRefusedExpired');

const unconnectedAccount = (bankId: string | null): AccountRow =>
  ({
    id: 'bybit-detail',
    name: 'Exchange',
    kind: 'crypto',
    institution: null,
    bankId,
    sortOrder: 0,
    createdAt: 0,
  }) as unknown as AccountRow;

const connectFailing = async (view: Awaited<ReturnType<typeof render>>) => {
  await fireEvent.changeText(view.getByPlaceholderText('Bybit API key'), 'api-key-fixture');
  await fireEvent.changeText(view.getByPlaceholderText('Bybit API secret'), 'secret-fixture');
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Bybit'));
  });
};

describe('CryptoSyncSection — the refusal a failed Bybit Connect leaves under the form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunCryptoSync.mockImplementation(async () => {
      throw new Error(REFUSAL());
    });
  });

  it('shows the refusal of the failed Connect', async () => {
    const view = await render(
      <CryptoSyncSection account={unconnectedAccount('bybit')} holdings={[]} />,
    );

    await connectFailing(view);

    expect(await view.findByText(REFUSAL())).toBeTruthy();
  });

  it.each(['Bybit API key', 'Bybit API secret'])(
    'drops the refusal once the user edits the %s field, since it says nothing of the new text',
    async (placeholder) => {
      const view = await render(
        <CryptoSyncSection account={unconnectedAccount('bybit')} holdings={[]} />,
      );

      await connectFailing(view);
      await view.findByText(REFUSAL());
      await fireEvent.changeText(view.getByPlaceholderText(placeholder), 'edited-fixture');

      expect(view.queryByText(REFUSAL())).toBeNull();
    },
  );

  it('shows the same refusal again when the edited key is refused again', async () => {
    const view = await render(
      <CryptoSyncSection account={unconnectedAccount('bybit')} holdings={[]} />,
    );

    await connectFailing(view);
    await view.findByText(REFUSAL());
    await fireEvent.changeText(view.getByPlaceholderText('Bybit API key'), 'edited-fixture');
    await act(async () => {
      await fireEvent.press(view.getByText('Connect Bybit'));
    });

    expect(await view.findByText(REFUSAL())).toBeTruthy();
  });

  it('drops the refusal when the user picks Change exchange or wallet', async () => {
    const view = await render(
      <CryptoSyncSection account={unconnectedAccount(null)} holdings={[]} />,
    );

    await fireEvent.press(view.getByText('Connect an exchange or wallet'));
    await fireEvent.press(view.getByTestId('connect-exchange-option-bybit'));
    await connectFailing(view);
    await view.findByText(REFUSAL());
    await fireEvent.press(view.getByText('Change exchange or wallet'));

    expect(view.queryByText(REFUSAL())).toBeNull();
  });
});
