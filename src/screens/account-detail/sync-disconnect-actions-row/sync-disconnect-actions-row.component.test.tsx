import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import SyncDisconnectActionsRow from './sync-disconnect-actions-row.component';

describe('SyncDisconnectActionsRow', () => {
  it('renders Sync and Disconnect side by side under the given testID', async () => {
    const { getByText, getByTestId } = await render(
      <SyncDisconnectActionsRow
        onSync={() => undefined}
        isSyncing={false}
        onDisconnect={() => undefined}
        testID="crypto-sync-actions-row"
      />,
    );

    expect(getByTestId('crypto-sync-actions-row')).toBeTruthy();
    expect(getByText('Sync')).toBeTruthy();
    expect(getByText('Disconnect')).toBeTruthy();
  });

  it('runs onSync when Sync is pressed, and onDisconnect when Disconnect is pressed', async () => {
    const onSync = jest.fn();
    const onDisconnect = jest.fn();
    const { getByText } = await render(
      <SyncDisconnectActionsRow
        onSync={onSync}
        isSyncing={false}
        onDisconnect={onDisconnect}
        testID="bank-sync-actions-row"
      />,
    );

    await fireEvent.press(getByText('Sync'));
    await fireEvent.press(getByText('Disconnect'));

    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('shows "Syncing…" and disables Sync while isSyncing, without disabling Disconnect', async () => {
    const { getByText, getByRole } = await render(
      <SyncDisconnectActionsRow
        onSync={() => undefined}
        isSyncing
        onDisconnect={() => undefined}
        testID="bank-sync-actions-row"
      />,
    );

    expect(getByText('Syncing…')).toBeTruthy();
    expect(getByRole('button', { name: 'Syncing…' })).toBeDisabled();
    expect(getByRole('button', { name: 'Disconnect' })).not.toBeDisabled();
  });
});
