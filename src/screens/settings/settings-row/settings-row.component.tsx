import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import SymbolIcon from '../../../design-system/components/symbol';

import { styles } from './settings-row.styles';
import { chevronSize } from './settings-row.chevron';
import type { SettingsRowProps } from './settings-row.props';

// A single full-width row inside a Settings GlassSurface card: an optional
// leading icon, a label, and either a trailing chevron (a navigating row, e.g.
// the Categories row) or full-width `children` rendered below the label (a
// non-navigating row, e.g. the inline base-currency switch). This is the ONE
// row shape every Settings card is built from, so adding another setting is a
// one-line addition rather than a new bespoke block.
const SettingsRow: FC<SettingsRowProps> = ({
  icon,
  label,
  onPress,
  trailing,
  children,
  ...props
}) => {
  const { theme } = useUnistyles();

  const header = (
    <Box direction="row" style={styles.header}>
      <Box direction="row" gap={3} style={styles.rowLead}>
        {icon !== undefined && <SymbolIcon name={icon} tone="textSecondary" />}
        <Box style={styles.label}>
          <Text variant="body">{label}</Text>
        </Box>
      </Box>

      {trailing !== undefined && <Box style={styles.trailing}>{trailing}</Box>}

      {onPress !== undefined && (
        // The chevron is a decorative affordance: the row's own button role
        // already conveys "navigates", so hide the glyph from the a11y tree
        // (otherwise a screen reader announces a bare "chevron"). Tests target
        // it by testID instead of a label. Sized to the label's OWN fontSize
        // (`chevronSize`, `settings-row.chevron.ts`) — see that module's doc
        // comment — rather than the oversized `iconSizes.body` default, so the
        // glyph reads as a peer of the title, not larger than it.
        <Box
          testID="settings-row-chevron"
          style={styles.chevron}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <SymbolIcon name="chevron.right" tone="textSecondary" size={chevronSize(theme)} />
        </Box>
      )}
    </Box>
  );

  if (onPress === undefined) {
    return (
      <Box gap={3} {...props}>
        {header}
        {children}
      </Box>
    );
  }

  return (
    <Pressable accessibilityRole="button" onPress={onPress} {...props}>
      {header}
      {children}
    </Pressable>
  );
};

export default SettingsRow;
