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
    mockUseSyncProgress.mockReturnValue({
      completed: 0,
      total: 0,
      workCompleted: 0,
      workTotal: 0,
    });
  });

  it('exposes the determinate WORK fraction as the accessibility value', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    // 1 of 2 holdings done, but only 2 of 11 work units — a heavy card still
    // dominates the fill. The a11y value tracks the WORK, matching the visible bar.
    mockUseSyncProgress.mockReturnValue({
      completed: 1,
      total: 2,
      workCompleted: 2,
      workTotal: 11,
    });

    const { getByTestId } = await render(<SyncProgressBar />);

    const bar = getByTestId('sync-progress-bar');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 11, now: 2 });
  });

  it('renders a user-facing label naming the HOLDINGS fraction being synced', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    // The label counts holdings (2 of 3) even though the fill is work-weighted.
    mockUseSyncProgress.mockReturnValue({
      completed: 2,
      total: 3,
      workCompleted: 5,
      workTotal: 20,
    });

    const { getByText } = await render(<SyncProgressBar />);

    expect(getByText('Syncing holdings 2/3')).toBeTruthy();
  });

  it('does not render when no sync is in flight', async () => {
    mockUseSyncStatus.mockReturnValue(false);
    mockUseSyncProgress.mockReturnValue({
      completed: 2,
      total: 3,
      workCompleted: 5,
      workTotal: 20,
    });

    const { queryByTestId } = await render(<SyncProgressBar />);

    expect(queryByTestId('sync-progress-bar')).toBeNull();
  });

  it('does not render before any work is known', async () => {
    mockUseSyncStatus.mockReturnValue(true);
    mockUseSyncProgress.mockReturnValue({
      completed: 0,
      total: 0,
      workCompleted: 0,
      workTotal: 0,
    });

    const { queryByTestId } = await render(<SyncProgressBar />);

    expect(queryByTestId('sync-progress-bar')).toBeNull();
  });
});
