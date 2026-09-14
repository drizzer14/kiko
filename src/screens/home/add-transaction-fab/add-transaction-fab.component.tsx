import { Pressable } from 'react-native';
import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import SymbolIcon from '../../../design-system/components/symbol';
import GlassSurface from '../../../design-system/components/glass-surface';

import { styles } from './add-transaction-fab.styles';
import type { AddTransactionFabProps } from './add-transaction-fab.props';

// The floating "+" action pinned bottom-right over the Home transaction list —
// the global way to add a manual transaction from anywhere, opening the shared
// create form with NO holding fixed (the form then shows its own primary-leg
// holding picker). It sits OUTSIDE the list's scroll content and lifts itself
// above the floating tab bar via the list's own `bottomOffset`. The visible
// circle is the shared design-system `GlassSurface` (neutral `transparent`
// variant — real Liquid Glass on iOS 26, a themed translucent fallback
// otherwise), never a hand-rolled glass effect or a flat accent fill; the
// Pressable stays the positioned, sized touch target and navigation is
// injected through `onPress` so the component stays presentational and
// decoupled from any stack's param typing.
const AddTransactionFab: FC<AddTransactionFabProps> = ({ onPress, bottomOffset }) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  // `bottomOffset` is a runtime value, so the positioned base style is a
  // function call — memoized so a Home re-render (e.g. a reactive fire during a
  // sync) does not rebuild an identical style object each time.
  const fabStyle = useMemo(() => styles.fab(bottomOffset), [bottomOffset]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.addTransaction')}
      onPress={onPress}
      style={({ pressed }) => [fabStyle, pressed && styles.pressed]}
    >
      <GlassSurface
        testID="add-transaction-fab-glass"
        radius="full"
        transparent
        style={styles.glass}
      >
        {/* `textPrimary` (white): a translucent glass background samples
        whatever sits behind it, so its effective tone varies with scroll
        content — a fixed white glyph is the one choice that stays legible
        (and WCAG-AA-safe) against every backdrop the live glass can show,
        unlike a semi-transparent `textSecondary` or a hue-dependent tinted
        glyph. */}
        <SymbolIcon name="plus" size={theme.iconSizes.title} tone="textPrimary" />
      </GlassSurface>
    </Pressable>
  );
};

export default AddTransactionFab;
