import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../design-system/components/box';
import Text from '../../design-system/components/text';
import { useSyncStatus } from '../../monobank/sync-status';

import { styles } from './syncing-indicator.styles';

/**
 * A small, globally-visible "a sync is running" signal, driven by the reactive
 * `useSyncStatus` store so ANY sync trigger (auto-sync on open,
 * pull-to-refresh, the manual button) lights it. Renders nothing when idle.
 *
 * Additive to the per-screen indicators (Home's `RefreshControl`, the
 * account-detail button spinner) — a single global signal that persists for
 * the whole of a slow multi-card sync, wherever the user has navigated.
 */
const SyncingIndicator: FC = () => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isSyncing = useSyncStatus();

  if (!isSyncing) {
    return null;
  }

  return (
    <Box
      accessible
      accessibilityLabel={t('common.syncing')}
      testID="syncing-indicator"
      direction="row"
      gap={2}
      style={styles.container}
    >
      <ActivityIndicator size="small" color={theme.colors.accent} />
      <Text variant="caption" tone="textSecondary">
        {t('common.syncing')}
      </Text>
    </Box>
  );
};

export default SyncingIndicator;
