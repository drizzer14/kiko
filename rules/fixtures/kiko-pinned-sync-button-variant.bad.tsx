import Button from '../../src/design-system/components/button';

// Semgrep fixture (POSITIVE): the account-detail Sync button
// ("accountDetail.syncNow") is pinned to `variant="secondaryTonal"`
// everywhere it appears (kiko-design-system's "Component set (Button)").
// `kiko-pinned-sync-button-variant` MUST report a finding on each pinned
// Button below, in both the plain and ternary label shapes.

const t = (key: string): string => key;
const isSynchronizing = false;

// EXPECT-FINDING
export const primarySyncButton = (
  <Button variant="primary" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.syncNow')}
  </Button>
);

// EXPECT-FINDING
export const ghostSyncButtonWithTernaryLabel = (
  <Button variant="ghost" size="small" fullWidth={false} onPress={() => undefined}>
    {isSynchronizing ? t('accountDetail.syncing') : t('accountDetail.syncNow')}
  </Button>
);
