import { act, render } from '@testing-library/react-native';

import '../../design-system/unistyles';
import '../../i18n';
import { setSyncing } from '../../monobank/sync-status';

import SyncingIndicator from './syncing-indicator.component';

describe('SyncingIndicator', () => {
  // The store is a module-level singleton; reset it BEFORE each test — by then
  // RNTL's auto-cleanup has unmounted the previous test's component, so this
  // reset notifies no live subscriber (an `afterEach` reset would fire into a
  // still-mounted component, an update outside `act`).
  beforeEach(() => {
    setSyncing(false);
  });

  it('renders nothing while not syncing', async () => {
    setSyncing(false);
    const { toJSON } = await render(<SyncingIndicator />);
    expect(toJSON()).toBeNull();
  });

  it('shows a labeled indicator while syncing', async () => {
    setSyncing(true);
    const { getByLabelText, getByText } = await render(<SyncingIndicator />);
    expect(getByLabelText('Syncing…')).toBeTruthy();
    expect(getByText('Syncing…')).toBeTruthy();
  });

  it('reactively appears when a sync starts and disappears when it settles', async () => {
    setSyncing(false);
    const { queryByText } = await render(<SyncingIndicator />);
    expect(queryByText('Syncing…')).toBeNull();

    await act(async () => {
      setSyncing(true);
    });
    expect(queryByText('Syncing…')).toBeTruthy();

    await act(async () => {
      setSyncing(false);
    });
    expect(queryByText('Syncing…')).toBeNull();
  });
});
