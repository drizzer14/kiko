import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import { useSyncProgress, useSyncStatus } from '../../../monobank/sync-status';

// The fill creeps toward JUST SHORT of the next card's completion over roughly
// the per-token rate-limit cadence, so a card whose statements span several 60s
// pages does not look frozen. A real per-card completion recomputes the target a
// full step higher. Per-card is the honest granularity — the bar may pause
// mid-card, which is acceptable.
const STEP_CREEP_MS = 55_000;
const NEXT_STEP_CREEP = 0.9;

/**
 * The determinate progress bar for the Home transactions list, driven by the
 * real per-card Monobank sync progress (`useSyncProgress`). It shows a label
 * ("Syncing transactions N/M") above a `completed / total` fill while a sync
 * fetches statements, and hides when the run ends.
 *
 * This bar is the WHOLE-RUN indicator: it tracks every trigger (a pull, the
 * manual button, and an auto-sync-on-open) through `isSyncing` + `useSyncProgress`,
 * and stays lit across the slow per-card statement loop. The native
 * pull-to-refresh spinner is a SEPARATE, decoupled signal that ends at the fast
 * balance phase (see the `RefreshControl` in `home.screen.tsx` and
 * `use-refresh-control-signal.ts`).
 */
const SyncProgressBar: FC = () => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
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
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {t('home.syncingTransactions', { completed, total })}
      </Text>

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
    </Box>
  );
};

export default SyncProgressBar;
