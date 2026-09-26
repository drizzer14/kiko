import Button from '../../src/design-system/components/button';

// Semgrep fixture (POSITIVE): the account-detail Change bank button
// ("accountDetail.changeBankAction") is pinned to `variant="secondaryTonal"`
// (kiko-design-system's "Component set (Button)"). `kiko-pinned-change-bank-
// button-variant` MUST report a finding on each pinned Button below.

const t = (key: string): string => key;

// EXPECT-FINDING
export const ghostChangeBankButton = (
  <Button variant="ghost" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.changeBankAction')}
  </Button>
);

// EXPECT-FINDING
export const primaryChangeBankButton = (
  <Button variant="primary" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.changeBankAction')}
  </Button>
);

// EXPECT-FINDING
export const noVariantChangeBankButton = (
  <Button size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.changeBankAction')}
  </Button>
);
