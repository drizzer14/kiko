import Button from '../../src/design-system/components/button';

// Semgrep fixture (POSITIVE): every sheet's Cancel button is pinned to the
// `confirm-sheet.component.tsx` shape — `variant="ghost"` AND
// `textColor={theme.colors.negative}` together. `kiko-pinned-cancel-button-
// style` MUST report a finding whenever either half of that pair is
// missing.

const t = (key: string): string => key;
const theme = { colors: { negative: 'systemRed' } };

// EXPECT-FINDING
export const secondaryCancelButton = (
  <Button variant="secondary" onPress={() => undefined}>
    {t('common.cancel')}
  </Button>
);

// EXPECT-FINDING
export const ghostCancelButtonWithoutNegativeTextColor = (
  <Button variant="ghost" onPress={() => undefined}>
    {t('common.cancel')}
  </Button>
);

// EXPECT-FINDING
export const negativeTextColorCancelButtonWithoutGhostVariant = (
  <Button variant="secondaryTonal" textColor={theme.colors.negative} onPress={() => undefined}>
    {t('common.cancel')}
  </Button>
);

// EXPECT-FINDING
export const noVariantCancelButton = (
  <Button onPress={() => undefined}>{t('common.cancel')}</Button>
);
