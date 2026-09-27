import Button from '@kiko/design-system/components/button';

// Semgrep fixture (NEGATIVE): `kiko-pinned-sync-button-variant` MUST report
// nothing on a Sync button already pinned to `variant="secondaryTonal"`, in
// both the plain and ternary label shapes, and MUST stay silent on an
// unrelated Button whose label is not the Sync string at all.

const t = (key: string): string => key;
const isSynchronizing = false;

export const secondaryTonalSyncButton = (
  <Button variant="secondaryTonal" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.syncNow')}
  </Button>
);

export const secondaryTonalSyncButtonWithTernaryLabel = (
  <Button variant="secondaryTonal" size="small" fullWidth={false} onPress={() => undefined}>
    {isSynchronizing ? t('accountDetail.syncing') : t('accountDetail.syncNow')}
  </Button>
);

export const unrelatedGhostButton = (
  <Button variant="ghost" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.disconnectAction')}
  </Button>
);
