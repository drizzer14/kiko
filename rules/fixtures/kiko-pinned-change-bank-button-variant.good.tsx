import Button from '../../src/design-system/components/button';

// Semgrep fixture (NEGATIVE): `kiko-pinned-change-bank-button-variant` MUST
// report nothing on a Change bank button already pinned to
// `variant="secondaryTonal"`, and MUST stay silent on an unrelated Button.

const t = (key: string): string => key;

export const secondaryTonalChangeBankButton = (
  <Button variant="secondaryTonal" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.changeBankAction')}
  </Button>
);

export const unrelatedPrimaryButton = (
  <Button variant="primary" size="small" fullWidth={false} onPress={() => undefined}>
    {t('accountDetail.addBankAction')}
  </Button>
);
