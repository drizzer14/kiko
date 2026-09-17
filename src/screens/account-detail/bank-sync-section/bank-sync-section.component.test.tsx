import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import type { AccountRow } from '../../../db/schema';

import BankSyncSection from './bank-sync-section.component';

const mockUseLiveQuery = jest.fn();
const mockMonobankSync = jest.fn();
const mockUseSync = jest.fn();
const mockPrivatbankSync = jest.fn();
const mockUseSyncAction = jest.fn();
const mockSaveToken = jest.fn();
const mockSavePrivatbankCredentials = jest.fn();
const mockDisconnectMonobank = jest.fn();
const mockDisconnectPrivatbank = jest.fn();

jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => mockUseSync(),
  useSyncAction: () => mockUseSyncAction(),
}));
jest.mock('../../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../../privatbank/credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSavePrivatbankCredentials(...args),
}));
jest.mock('../../../monobank/disconnect', () => ({
  disconnectMonobank: (...args: unknown[]) => mockDisconnectMonobank(...args),
}));
jest.mock('../../../privatbank/disconnect', () => ({
  disconnectPrivatbank: (...args: unknown[]) => mockDisconnectPrivatbank(...args),
}));
// The two connect fields are tested on their own; here each collapses to one
// pressable that fires `onConnect` with a fixture, so the section's wiring
// (which field renders, and where its `onConnect` result goes) is what is
// under test.
jest.mock('../monobank-connect-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onConnect }: { onConnect: (token: string) => Promise<boolean> }) => (
      <Pressable accessibilityLabel="monobank-field" onPress={() => onConnect('mono-token')}>
        <Text>monobank field</Text>
      </Pressable>
    ),
  };
});
jest.mock('../privatbank-connect-field', () => {
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({
      onConnect,
    }: {
      onConnect: (token: string, clientId: string) => Promise<boolean>;
    }) => (
      <Pressable
        accessibilityLabel="privatbank-field"
        onPress={() => onConnect('privat-token', 'client-1')}
      >
        <Text>privatbank field</Text>
      </Pressable>
    ),
  };
});

const bankAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'My Bank',
  kind: 'bank',
  institution: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLiveQuery.mockReturnValue({ data: [] });
  mockMonobankSync.mockResolvedValue(undefined);
  mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockMonobankSync });
  mockPrivatbankSync.mockResolvedValue(undefined);
  mockUseSyncAction.mockReturnValue({
    isSyncing: false,
    error: undefined,
    sync: mockPrivatbankSync,
  });
  mockSaveToken.mockResolvedValue(undefined);
  mockSavePrivatbankCredentials.mockResolvedValue(undefined);
  mockDisconnectMonobank.mockResolvedValue(undefined);
  mockDisconnectPrivatbank.mockResolvedValue(undefined);
});

describe('BankSyncSection — disconnected', () => {
  it('shows the "Add a bank" trigger, then the picker sheet listing both native providers', async () => {
    const view = await render(<BankSyncSection account={bankAccount()} />);

    expect(view.getByText('Add a bank')).toBeTruthy();

    await fireEvent.press(view.getByText('Add a bank'));

    expect(view.getByTestId('add-bank-sheet')).toBeTruthy();
    expect(view.getByText('Monobank')).toBeTruthy();
    expect(view.getByText('PrivatBank')).toBeTruthy();
  });

  it('renders the Monobank field after picking Monobank, and connecting saves the token then syncs', async () => {
    const view = await render(<BankSyncSection account={bankAccount()} />);

    await fireEvent.press(view.getByText('Add a bank'));
    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(view.getByText('monobank field')).toBeTruthy();
    expect(view.queryByText('privatbank field')).toBeNull();

    await act(async () => {
      await fireEvent.press(view.getByLabelText('monobank-field'));
    });

    expect(mockSaveToken).toHaveBeenCalledWith('a', 'mono-token');
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledWith('a'));
    expect(mockSavePrivatbankCredentials).not.toHaveBeenCalled();
  });

  it('renders the PrivatBank field after picking PrivatBank, and connecting saves the pair then syncs via PrivatBank', async () => {
    const view = await render(<BankSyncSection account={bankAccount()} />);

    await fireEvent.press(view.getByText('Add a bank'));
    await fireEvent.press(view.getByTestId('add-bank-option-privatbank'));

    expect(view.getByText('privatbank field')).toBeTruthy();
    expect(view.queryByText('monobank field')).toBeNull();

    await act(async () => {
      await fireEvent.press(view.getByLabelText('privatbank-field'));
    });

    expect(mockSavePrivatbankCredentials).toHaveBeenCalledWith('a', {
      token: 'privat-token',
      clientId: 'client-1',
    });
    await waitFor(() => expect(mockPrivatbankSync).toHaveBeenCalledWith('a'));
    expect(mockSaveToken).not.toHaveBeenCalled();
  });

  it('surfaces the active sync error below the field', async () => {
    mockUseSyncAction.mockReturnValue({
      isSyncing: false,
      error: 'privatbank boom',
      sync: mockPrivatbankSync,
    });
    const view = await render(<BankSyncSection account={bankAccount()} />);

    await fireEvent.press(view.getByText('Add a bank'));
    await fireEvent.press(view.getByTestId('add-bank-option-privatbank'));

    expect(view.getByText('privatbank boom')).toBeTruthy();
  });
});

describe('BankSyncSection — connected', () => {
  it('shows Sync + Disconnect for a Monobank-connected account, syncing through the Monobank action', async () => {
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'monobank' })} />,
    );

    expect(view.getByTestId('bank-sync-status-actions')).toBeTruthy();
    await fireEvent.press(view.getByText('Sync'));

    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledWith('a'));
    expect(mockPrivatbankSync).not.toHaveBeenCalled();
  });

  it('confirms and routes Disconnect to disconnectMonobank for a Monobank-connected account', async () => {
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'monobank' })} />,
    );

    await fireEvent.press(view.getByText('Disconnect'));
    expect(view.getByText('Disconnect Monobank')).toBeTruthy();
    await fireEvent.press(view.getByTestId('bank-disconnect-confirm'));

    await waitFor(() => expect(mockDisconnectMonobank).toHaveBeenCalledWith('a'));
    expect(mockDisconnectPrivatbank).not.toHaveBeenCalled();
  });

  it('shows Sync + Disconnect for a PrivatBank-connected account, syncing through the PrivatBank action', async () => {
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'privatbank' })} />,
    );

    expect(view.getByTestId('bank-sync-status-actions')).toBeTruthy();
    await fireEvent.press(view.getByText('Sync'));

    await waitFor(() => expect(mockPrivatbankSync).toHaveBeenCalledWith('a'));
    expect(mockMonobankSync).not.toHaveBeenCalled();
  });

  it('confirms and routes Disconnect to disconnectPrivatbank for a PrivatBank-connected account', async () => {
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'privatbank' })} />,
    );

    await fireEvent.press(view.getByText('Disconnect'));
    expect(view.getByText('Disconnect PrivatBank')).toBeTruthy();
    await fireEvent.press(view.getByTestId('bank-disconnect-confirm'));

    await waitFor(() => expect(mockDisconnectPrivatbank).toHaveBeenCalledWith('a'));
    expect(mockDisconnectMonobank).not.toHaveBeenCalled();
  });

  it('shows a syncing label while the active provider is syncing', async () => {
    mockUseSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockMonobankSync });
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'monobank' })} />,
    );

    expect(view.getByText('Syncing…')).toBeTruthy();
  });
});
