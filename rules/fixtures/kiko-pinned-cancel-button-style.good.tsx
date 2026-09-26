import Button from '../../src/design-system/components/button';

// Semgrep fixture (NEGATIVE): `kiko-pinned-cancel-button-style` MUST report
// nothing on a Cancel button already carrying BOTH `variant="ghost"` and
// `textColor={theme.colors.negative}` (the confirm-sheet shape), regardless
// of attribute order, and MUST stay silent on an unrelated Button.

const t = (key: string): string => key;
const theme = { colors: { negative: 'systemRed' } };

export const ghostNegativeCancelButton = (
  <Button variant="ghost" textColor={theme.colors.negative} onPress={() => undefined}>
    {t('common.cancel')}
  </Button>
);

export const negativeGhostCancelButton = (
  <Button textColor={theme.colors.negative} variant="ghost" onPress={() => undefined}>
    {t('common.cancel')}
  </Button>
);

export const unrelatedSecondaryButton = (
  <Button variant="secondary" onPress={() => undefined}>
    {t('common.save')}
  </Button>
);
