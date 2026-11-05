import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { AccountRow } from '@kiko/db';

import BankSyncSection from './bank-sync-section.component';

const mockUseLiveQuery = jest.fn();
const mockMonobankSync = jest.fn();
const mockSaveToken = jest.fn();
const mockFetchClientInfo = jest.fn();
const mockIsMonobankSyncRunning = jest.fn<boolean, [string]>();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: async () => undefined,
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => ({ isSyncing: false, error: undefined, sync: mockMonobankSync }),
}));
jest.mock('@kiko/monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('@kiko/monobank/disconnect', () => ({
  disconnectMonobank: async () => undefined,
}));
jest.mock('@kiko/monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
// The real run pulls the repos, and so op-sqlite, into the graph; the join itself is pinned in
// monobank-connect-field.component.running-sync.test.tsx.
jest.mock('@kiko/monobank/sync', () => ({
  isMonobankSyncRunning: (accountId: string) => mockIsMonobankSyncRunning(accountId),
}));

const RUNNING_TEXT = i18n.t('accountDetail.monobankSyncStillRunning');

const bankAccount = (id: string): AccountRow => ({
  id,
  name: 'My Bank',
  kind: 'bank',
  institution: null,
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  currency: 'UAH',
  createdAt: 0,
});

const connectOn = async (accountId: string) => {
  const view = await render(<BankSyncSection account={bankAccount(accountId)} />);

  await fireEvent.press(view.getByText('Add a bank'));
  await fireEvent.press(view.getByTestId('add-bank-option-monobank'));
  await fireEvent.changeText(view.getByPlaceholderText('Monobank token'), 'tok-123');
  await act(async () => {
    await fireEvent.press(view.getByText(i18n.t('accountDetail.connectMonobank')));
  });

  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLiveQuery.mockReturnValue({ data: [] });
  mockIsMonobankSyncRunning.mockReturnValue(false);
  mockMonobankSync.mockResolvedValue(true);
  mockSaveToken.mockResolvedValue(undefined);
  mockFetchClientInfo.mockResolvedValue({ name: 'Ada' });
});

describe('BankSyncSection — a Monobank Connect during a running sync', () => {
  it('shows the running text for the account id its Connect syncs, and saves and syncs nothing', async () => {
    mockIsMonobankSyncRunning.mockImplementation((accountId) => accountId === 'section-blocked');

    const view = await connectOn('section-blocked');

    expect(await view.findByText(RUNNING_TEXT)).toBeTruthy();
    expect(mockFetchClientInfo).not.toHaveBeenCalled();
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockMonobankSync).not.toHaveBeenCalled();
    expect(view.queryByText(/Connected as/)).toBeNull();
  });

  it('syncs the same account id once only another account is running', async () => {
    mockIsMonobankSyncRunning.mockImplementation((accountId) => accountId === 'section-other');

    const view = await connectOn('section-free');

    expect(
      await view.findByText(i18n.t('accountDetail.connectedAs', { name: 'Ada' })),
    ).toBeTruthy();
    expect(view.queryByText(RUNNING_TEXT)).toBeNull();
    expect(mockSaveToken).toHaveBeenCalledWith('section-free', 'tok-123');
    expect(mockMonobankSync).toHaveBeenCalledWith('section-free');
  });
});
