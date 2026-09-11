import type { FC } from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import SymbolIcon from '../symbol';
import Text from '../text';

import type { SelectableRowProps } from './selectable-row.props';
import { styles } from './selectable-row.styles';

// The shared single-select row style: a 44pt-minimum tap target that fills
// with the accent background when selected (the OptionPills/ChipRow selection
// vocabulary), generalized from the Statistics manual-mode category row
// (`trend-filter-field.component.tsx`'s `ManualCategoryRow`) so every category
// picker in the app converges on one style.
const SelectableRow: FC<SelectableRowProps> = ({
  selected,
  onPress,
  label,
  icon,
  iconColor,
  reserveIconSlot = false,
  accessibilityRole = 'button',
  accessibilityLabel,
  onLayout,
  testID,
}) => {
  const { theme } = useUnistyles();
  const showIconSlot = icon != null || reserveIconSlot;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityRole === 'checkbox' ? { checked: selected } : { selected }}
      onPress={onPress}
      onLayout={onLayout}
      testID={testID}
      style={selected ? [styles.option, styles.optionSelected] : styles.option}
    >
      <View style={styles.optionInner}>
        <View style={styles.check}>
          {selected && (
            <SymbolIcon name="checkmark" size={theme.iconSizes.caption} tone="onAccent" />
          )}
        </View>

        {showIconSlot && (
          <View style={styles.icon}>
            {icon != null && (
              <SymbolIcon
                name={icon}
                size={theme.iconSizes.body}
                {...(selected ? { tone: 'onAccent' as const } : { color: iconColor })}
              />
            )}
          </View>
        )}

        {/* The label sits in a flex:1 View rather than carrying `flex` itself —
            Text's `style` prop intentionally allows only typography keys, so the
            row's space-filling belongs on a layout wrapper, not the Text. */}
        <View style={styles.label}>
          <Text variant="body" tone={selected ? 'onAccent' : 'textPrimary'}>
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

export default SelectableRow;
