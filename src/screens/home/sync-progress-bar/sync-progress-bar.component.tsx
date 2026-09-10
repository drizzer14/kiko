import { type FC, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import { useSyncProgress, useSyncStatus } from '../../../monobank/sync-status';

// The fill creeps toward JUST SHORT of the next work unit over roughly the
// per-token rate-limit cadence, so a card whose statements span several 60s pages
// does not look frozen. A real per-page work commit recomputes the target a full
// unit higher. Per-page is the honest granularity — the bar may pause mid-page,
// which is acceptable.
const STEP_CREEP_MS = 55_000;
const NEXT_STEP_CREEP = 0.9;

/**
 * The determinate progress bar for the Home transactions list, driven by the
 * WORK-WEIGHTED sync progress (`useSyncProgress`). The FILL tracks `workCompleted
 * / workTotal`, so a Monobank card with a large statement history occupies
 * proportionally more of the bar than a fast crypto balance fetch, and there is NO
 * pre-filled baseline. The LABEL ("Syncing holdings N/M") counts HOLDINGS — the
 * holdings doing real work this run and how many have finished — decoupled from
 * the fill (the file-copy pattern: "1 / 2 holdings" can sit at a small fill while
 * a heavy card still fetches). See the progress session in `sync-status.ts`.
 *
 * This bar is the WHOLE-RUN indicator: it tracks every trigger (a pull, the
 * manual button, an auto-sync-on-open) through `isSyncing` + `useSyncProgress`,
 * across the WHOLE fan-out — the Monobank run AND every connected crypto account —
 * and stays lit across the slow per-card statement loop. Because `isSyncing` now
 * rides the shared progress session, a crypto-only fan-out (no Monobank run) still
 * lights the bar. The native pull-to-refresh spinner is a SEPARATE, decoupled
 * signal that ends at the fast balance phase (see the `RefreshControl` in
 * `home.screen.tsx` and `use-refresh-control-signal.ts`).
 */
const SyncProgressBar: FC = () => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isSyncing = useSyncStatus();
  const { completed, total, workCompleted, workTotal } = useSyncProgress();

  const fill = useSharedValue(0);

  useEffect(() => {
    const target = workTotal > 0 ? Math.min((workCompleted + NEXT_STEP_CREEP) / workTotal, 1) : 0;
    fill.value = withTiming(target, { duration: STEP_CREEP_MS });
  }, [workCompleted, workTotal, fill]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  // Nothing to show until a sync is in flight AND it has real work to do
  // (published once the run decides its fetched set — see the no-op guard).
  if (!isSyncing || workTotal <= 0) {
    return null;
  }

  return (
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {t('home.syncingHoldings', { completed, total })}
      </Text>

      <View
        testID="sync-progress-bar"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: workTotal, now: workCompleted }}
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
