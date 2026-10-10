import { darkTheme } from '@kiko/design-system/theme';
import { render } from '@testing-library/react-native';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

// Register the design-system theme so `useUnistyles()` resolves inside this
// isolated render (the app entry imports it transitively; a lone component test
// must import it itself).
import '@kiko/design-system/unistyles';
// Initialize i18next so the bar's `t()` label resolves to the real catalogue
// string rather than the bare key.
import '@kiko/i18n/init';

// The determinate progress bar reads the two sync-status signals directly; drive
// them from the test so a render can assert the rendered fraction and the
// hide-when-done behaviour.
const mockUseSyncStatus = jest.fn();
const mockUseSyncProgress = jest.fn();
jest.mock('@kiko/monobank/sync-status', () => ({
  useSyncStatus: () => mockUseSyncStatus(),
  useSyncProgress: () => mockUseSyncProgress(),
}));

// Spy on `withTiming` only: the shared stub resolves it to its target and drops the
// config, so the duration the bar asks for is otherwise invisible to a test.
const mockWithTiming = jest.fn((target: number, _config?: { duration?: number }) => target);
jest.mock('react-native-reanimated', () => {
  const stub = require('../../../../jest/reanimated-mock');

  return new Proxy(stub, {
    get: (target, property) =>
      property === 'withTiming'
        ? (...parameters: [number, { duration?: number }]) => mockWithTiming(...parameters)
        : target[property],
  });
});

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

  const progress = (workCompleted: number, workTotal: number) => ({
    completed: 1,
    total: 2,
    workCompleted,
    workTotal,
  });

  const fillStyleOf = (bar: { children: unknown[] }): Record<string, unknown> => {
    const fill = bar.children[0] as { props: { style: StyleProp<ViewStyle> } };

    return { ...StyleSheet.flatten(fill.props.style) };
  };

  describe('fill target', () => {
    it('animates to the work fraction plus the next-step creep, over the creep duration', async () => {
      mockUseSyncProgress.mockReturnValue(progress(4, 10));

      await render(<SyncProgressBar />);

      expect(mockWithTiming).toHaveBeenCalledWith(expect.closeTo(0.49, 10), { duration: 55_000 });
    });

    it('caps the target at a full bar when the creep passes the last work unit', async () => {
      mockUseSyncProgress.mockReturnValue(progress(10, 10));

      await render(<SyncProgressBar />);

      expect(mockWithTiming).toHaveBeenCalledWith(1, { duration: 55_000 });
    });

    it('animates to zero while no work is known', async () => {
      mockUseSyncProgress.mockReturnValue(progress(0, 0));

      await render(<SyncProgressBar />);

      expect(mockWithTiming).toHaveBeenCalledWith(0, { duration: 55_000 });
    });

    it('retargets when the work completed changes on a later render', async () => {
      mockUseSyncProgress.mockReturnValue(progress(2, 10));
      const { rerender } = await render(<SyncProgressBar />);

      mockUseSyncProgress.mockReturnValue(progress(6, 10));
      await rerender(<SyncProgressBar />);

      expect(mockWithTiming).toHaveBeenLastCalledWith(expect.closeTo(0.69, 10), {
        duration: 55_000,
      });
    });

    it('retargets when only the work total changes on a later render', async () => {
      mockUseSyncProgress.mockReturnValue(progress(2, 10));
      const { rerender } = await render(<SyncProgressBar />);

      mockUseSyncProgress.mockReturnValue(progress(2, 5));
      await rerender(<SyncProgressBar />);

      expect(mockWithTiming).toHaveBeenLastCalledWith(expect.closeTo(0.58, 10), {
        duration: 55_000,
      });
    });

    it('does not retarget when the work progress is unchanged', async () => {
      mockUseSyncProgress.mockReturnValue(progress(2, 10));
      const { rerender } = await render(<SyncProgressBar />);

      await rerender(<SyncProgressBar />);

      expect(mockWithTiming).toHaveBeenCalledTimes(1);
    });
  });

  describe('rendered bar', () => {
    it('sizes the fill as the animated target percentage of the track', async () => {
      mockUseSyncProgress.mockReturnValue(progress(4, 10));
      const { getByTestId, rerender } = await render(<SyncProgressBar />);

      await rerender(<SyncProgressBar />);

      const width = String(fillStyleOf(getByTestId('sync-progress-bar')).width);

      expect(Number.parseFloat(width)).toBeCloseTo(49, 5);
      expect(width).toMatch(/%$/);
    });

    it('styles the track as a clipped rounded surface the height of one spacing step', async () => {
      mockUseSyncProgress.mockReturnValue(progress(4, 10));

      const { getByTestId } = await render(<SyncProgressBar />);

      expect(StyleSheet.flatten(getByTestId('sync-progress-bar').props.style)).toEqual({
        height: darkTheme.spacing(1),
        borderRadius: darkTheme.radii.sm,
        backgroundColor: darkTheme.colors.surfaceHigh,
        overflow: 'hidden',
      });
    });

    it('styles the fill as the accent colour at the full height of the track', async () => {
      mockUseSyncProgress.mockReturnValue(progress(4, 10));
      const { getByTestId } = await render(<SyncProgressBar />);

      expect(fillStyleOf(getByTestId('sync-progress-bar'))).toMatchObject({
        height: '100%',
        backgroundColor: darkTheme.colors.accent,
      });
    });
  });
});
