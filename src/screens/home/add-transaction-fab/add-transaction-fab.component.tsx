import { Pressable } from 'react-native';
import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import SymbolIcon from '../../../design-system/components/symbol';

import { styles } from './add-transaction-fab.styles';
import type { AddTransactionFabProps } from './add-transaction-fab.props';

// The floating "+" action pinned bottom-right over the Home transaction list —
// the global way to add a manual transaction from anywhere, opening the shared
// create form with NO holding fixed (the form then shows its own primary-leg
// holding picker). It sits OUTSIDE the list's scroll content and lifts itself
// above the floating tab bar via the list's own `bottomOffset`. A plain accent
// circle with a white glyph; navigation is injected through `onPress` so the
// component stays presentational and decoupled from any stack's param typing.
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
      <SymbolIcon name="plus" size={theme.iconSizes.title} tone="onAccent" />
    </Pressable>
  );
};

export default AddTransactionFab;
