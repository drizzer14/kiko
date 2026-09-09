import { render } from '@testing-library/react-native';

// Register the design-system theme so `useUnistyles()` resolves inside this
// isolated render (the app entry imports it transitively; a lone component test
// must import it itself).
import '../../../design-system/unistyles';
// Initialize i18next so the bar's `t()` label resolves to the real catalogue
// string rather than the bare key.
import '../../../i18n';

// The determinate progress bar reads the two sync-status signals directly; drive
// them from the test so a render can assert the rendered fraction and the
// hide-when-done behaviour.
const mockUseSyncStatus = jest.fn();
const mockUseSyncProgress = jest.fn();
jest.mock('../../../monobank/sync-status', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
  useSyncProgress: () => mockUseSyncProgress(),
}));

import SyncProgressBar from './sync-progress-bar.component';

describe('SyncProgressBar', () => {
  beforeEach(() => {
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({ completed: 0, total: 0 });
  });

  it('renders the determinate fraction while a sync fetches', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({ completed: 1, total: 3 });

    const { getByTestId } = await render(<SyncProgressBar />);

    // The honest fraction is exposed as the progressbar's accessibility value —
    // 1 of 3 holdings synced — regardless of the animated fill's current width.
    const bar = getByTestId('sync-progress-bar');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 3, now: 1 });
  });

  it('renders a user-facing label naming the holdings fraction being synced', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({ completed: 2, total: 3 });

    // The bar is the whole-run indicator, so it carries a readable label. The
    // fraction now counts HOLDINGS (the holdings the user sees), not cards: the
    // completed count starts at the holdings that do not require syncing.
    const { getByText } = await render(<SyncProgressBar />);

    expect(getByText('Syncing holdings 2/3')).toBeTruthy();
  });

  it('does not render when no sync is in flight', async () => {
    mockUseSyncStatus.mockReturnValue(false);
    mockUseSyncProgress.mockReturnValue({ completed: 2, total: 3 });

    const { queryByTestId } = await render(<SyncProgressBar />);

    expect(queryByTestId('sync-progress-bar')).toBeNull();
  });

  it('does not render before a total is known', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({ completed: 0, total: 0 });

    const { queryByTestId } = await render(<SyncProgressBar />);

    expect(queryByTestId('sync-progress-bar')).toBeNull();
  });
});
