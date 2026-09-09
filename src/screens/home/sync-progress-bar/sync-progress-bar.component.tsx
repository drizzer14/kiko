import { type FC, useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

import { useSyncProgress, useSyncStatus } from '../../../monobank/sync-status';

// The fill creeps toward JUST SHORT of the next card's completion over roughly
// the per-token rate-limit cadence, so a card whose statements span several 60s
// pages does not look frozen. A real per-card completion recomputes the target a
// full step higher. Per-card is the honest granularity — the bar may pause
// mid-card, which is acceptable.
const STEP_CREEP_MS = 55_000;
const NEXT_STEP_CREEP = 0.9;

/**
 * A thin determinate progress bar for the Home transactions list, driven by the
 * real per-card Monobank sync progress (`useSyncProgress`). It shows
 * `completed / total` while a sync is fetching statements and hides when the run
 * ends. The native pull-to-refresh spinner is a SEPARATE signal (see the
 * `RefreshControl` in `home.screen.tsx`); this bar is the list-level progress
 * affordance the user asked for, not a replacement for that spinner.
 */
const SyncProgressBar: FC = () => {
  const { theme } = useUnistyles();
  const isSyncing = useSyncStatus();
  const { completed, total } = useSyncProgress();

  const fill = useSharedValue(0);

  useEffect(() => {
    const target = total > 0 ? Math.min((completed + NEXT_STEP_CREEP) / total, 1) : 0;
    fill.value = withTiming(target, { duration: STEP_CREEP_MS });
  }, [completed, total, fill]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  // Nothing to show until a sync is in flight AND its total is known (published
  // once the balance-diff skip decides the non-skipped set).
  if (!isSyncing || total <= 0) {
    return null;
  }

  return (
    <View
      testID="sync-progress-bar"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: completed }}
      style={{
        height: theme.spacing(1),
        borderRadius: theme.radii.sm,
        backgroundColor: theme.colors.surfaceHigh,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[{ height: '100%', backgroundColor: theme.colors.accent }, fillStyle]}
      />
    </View>
  );
};

export default SyncProgressBar;
