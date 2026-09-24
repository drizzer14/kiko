import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import type { AccountRow } from '../../../db/schema';

import BankSyncSection from './bank-sync-section.component';

const mockUseLiveQuery = jest.fn();
const mockMonobankSync = jest.fn();
const mockUseSync = jest.fn();
const mockSaveToken = jest.fn();
const mockDisconnectMonobank = jest.fn();

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
}));
jest.mock('../../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../../monobank/disconnect', () => ({
  disconnectMonobank: (...args: unknown[]) => mockDisconnectMonobank(...args),
}));
// The Monobank field is tested on its own; here it collapses to one
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

const bankAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'My Bank',
  kind: 'bank',
  institution: null,
  bankId: null,
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
  mockSaveToken.mockResolvedValue(undefined);
  mockDisconnectMonobank.mockResolvedValue(undefined);
});

describe('BankSyncSection — disconnected', () => {
  it('shows the "Add a bank" trigger, then the picker sheet listing the shipped native provider', async () => {
    const view = await render(<BankSyncSection account={bankAccount()} />);

    expect(view.getByText('Add a bank')).toBeTruthy();

    await fireEvent.press(view.getByText('Add a bank'));

    expect(view.getByTestId('add-bank-sheet')).toBeTruthy();
    expect(view.getByText('Monobank')).toBeTruthy();
  });

  it('renders the Monobank field after picking Monobank, and connecting saves the token then syncs', async () => {
    const view = await render(<BankSyncSection account={bankAccount()} />);

    await fireEvent.press(view.getByText('Add a bank'));
    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(view.getByText('monobank field')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(view.getByLabelText('monobank-field'));
    });

    expect(mockSaveToken).toHaveBeenCalledWith('a', 'mono-token');
    await waitFor(() => expect(mockMonobankSync).toHaveBeenCalledWith('a'));
  });

  it('offers a Change action once a provider is picked, which re-shows the "Add a bank" trigger', async () => {
    const view = await render(<BankSyncSection account={bankAccount()} />);

    await fireEvent.press(view.getByText('Add a bank'));
    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(view.getByText('monobank field')).toBeTruthy();
    expect(view.getByText('Change bank')).toBeTruthy();

    await fireEvent.press(view.getByText('Change bank'));

    expect(view.getByText('Add a bank')).toBeTruthy();
    expect(view.queryByText('monobank field')).toBeNull();

    // The picker is fully reopenable — the mechanism this test proves, even
    // though only one provider is wired today.
    await fireEvent.press(view.getByText('Add a bank'));
    expect(view.getByTestId('add-bank-sheet')).toBeTruthy();
  });

  it('surfaces the active sync error below the field', async () => {
    mockUseSync.mockReturnValue({
      isSyncing: false,
      error: 'monobank boom',
      sync: mockMonobankSync,
    });
    const view = await render(<BankSyncSection account={bankAccount()} />);

    await fireEvent.press(view.getByText('Add a bank'));
    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(view.getByText('monobank boom')).toBeTruthy();
  });

  // Item 1 (F3): an account whose identity picker (BankTypeField, in the
  // account form) already identified it as Monobank must not re-ask via the
  // generic "Add a bank" picker (redundant when Monobank is the only
  // connectable provider) — it goes straight to the Connect field.
  it('skips the "Add a bank" trigger and goes straight to the Monobank field when bankId is already monobank', async () => {
    const view = await render(<BankSyncSection account={bankAccount({ bankId: 'monobank' })} />);

    expect(view.queryByText('Add a bank')).toBeNull();
    expect(view.getByText('monobank field')).toBeTruthy();
    expect(view.getByText('Change bank')).toBeTruthy();
  });

  // DEFAULT (I1, F3 part 1 fix round 1): "Change bank" clears the user's own
  // pick, but the section still FOLLOWS `bankId` live — on an account
  // already identified as Monobank (the one shipped connectable provider),
  // pressing "Change bank" therefore re-derives straight back to the Connect
  // field rather than the generic picker; there is nothing else to pick.
  it('DEFAULT: "Change bank" on an already-Monobank account re-shows Connect immediately (no picker) — bankId still says Monobank', async () => {
    const view = await render(<BankSyncSection account={bankAccount({ bankId: 'monobank' })} />);

    await fireEvent.press(view.getByText('Change bank'));

    expect(view.queryByText('Add a bank')).toBeNull();
    expect(view.getByText('monobank field')).toBeTruthy();
  });

  // I1 (F3 part 1 fix round 1, Important): the mount-once `useState` seed
  // only read `bankId` once — editing the bank to Monobank AFTER this
  // component already mounted (AccountForm pops, the live-queried `account`
  // prop updates with the SAME component instance still mounted) left the
  // section showing "Add a bank" forever, the exact label item 1 says must
  // not appear. The shown provider must follow `account.bankId` LIVE, not
  // just at mount.
  it('follows bankId LIVE: editing an unidentified bank account to Monobank switches "Add a bank" to Connect, with no remount', async () => {
    const view = await render(<BankSyncSection account={bankAccount({ bankId: null })} />);

    expect(view.getByText('Add a bank')).toBeTruthy();

    await act(async () => {
      view.rerender(<BankSyncSection account={bankAccount({ bankId: 'monobank' })} />);
    });

    expect(view.queryByText('Add a bank')).toBeNull();
    expect(view.getByText('monobank field')).toBeTruthy();
  });

  // I1's second transition: Disconnect does not clear `bankId` (only
  // `institution` — see `kiko-architecture`'s "bankId is identity-only,
  // independent of institution"), so a just-disconnected account is STILL
  // Monobank and must show Connect again, not "Add a bank".
  it('follows bankId LIVE: disconnecting a Monobank account (bankId unchanged) shows Connect again, not "Add a bank"', async () => {
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'monobank', bankId: 'monobank' })} />,
    );

    await fireEvent.press(view.getByText('Disconnect'));
    await fireEvent.press(view.getByTestId('bank-disconnect-confirm'));
    await waitFor(() => expect(mockDisconnectMonobank).toHaveBeenCalledWith('a'));

    // Disconnect itself clears `institution`, not `bankId` — the live query
    // re-renders this same instance with the post-disconnect row.
    await act(async () => {
      view.rerender(
        <BankSyncSection account={bankAccount({ institution: null, bankId: 'monobank' })} />,
      );
    });

    expect(view.queryByText('Add a bank')).toBeNull();
    expect(view.getByText('monobank field')).toBeTruthy();
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
  });

  it('confirms and routes Disconnect to disconnectMonobank for a Monobank-connected account', async () => {
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'monobank' })} />,
    );

    await fireEvent.press(view.getByText('Disconnect'));
    expect(view.getByText('Disconnect Monobank')).toBeTruthy();
    await fireEvent.press(view.getByTestId('bank-disconnect-confirm'));

    await waitFor(() => expect(mockDisconnectMonobank).toHaveBeenCalledWith('a'));
  });

  it('shows a syncing label while the active provider is syncing', async () => {
    mockUseSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockMonobankSync });
    const view = await render(
      <BankSyncSection account={bankAccount({ institution: 'monobank' })} />,
    );

    expect(view.getByText('Syncing…')).toBeTruthy();
  });
});
