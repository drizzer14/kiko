import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Button from '@kiko/design-system/components/button';

import type { SyncDisconnectActionsRowProps } from './sync-disconnect-actions-row.props';

// The shared Sync + Disconnect action row for a connected bank/crypto
// account — both buttons take the neutral `secondaryTonal` treatment (see
// kiko-design-system's "Component set (Button)"), Sync taking the iOS-26
// rotate glyph (the central IOS26_SYMBOL_FALLBACKS map hands the iOS-15.1-safe
// fallback for free, even through the shared Button's `icon` prop) and
// Disconnect the open-lock glyph.
const SyncDisconnectActionsRow: FC<SyncDisconnectActionsRowProps> = ({
  onSync,
  isSyncing,
  onDisconnect,
  testID,
}) => {
  const { t } = useTranslation();

  return (
    <Box direction="row" gap={2} testID={testID}>
      <Button
        variant="secondaryTonal"
        size="small"
        fullWidth={false}
        onPress={onSync}
        disabled={isSyncing}
        icon="arrow.trianglehead.2.clockwise.rotate.90"
      >
        {isSyncing ? t('accountDetail.syncing') : t('accountDetail.syncNow')}
      </Button>

      <Button
        variant="secondaryTonal"
        size="small"
        fullWidth={false}
        onPress={onDisconnect}
        icon="lock.open"
      >
        {t('accountDetail.disconnectAction')}
      </Button>
    </Box>
  );
};

export default SyncDisconnectActionsRow;
