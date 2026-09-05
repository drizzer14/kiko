import type { FC } from 'react';
import { Pressable } from 'react-native';

import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import { styles } from '../settings.styles';

import type { SettingsRowProps } from './settings-row.props';

// A single full-width row inside a Settings GlassSurface card: an optional
// leading icon, a label, and either a trailing chevron (a navigating row, e.g.
// the Categories row) or full-width `children` rendered below the label (a
// non-navigating row, e.g. the inline base-currency switch). This is the ONE
// row shape every Settings card is built from, so adding another setting is a
// one-line addition rather than a new bespoke block.
const SettingsRow: FC<SettingsRowProps> = ({ icon, label, onPress, children, ...props }) => {
  const header = (
    <Box direction="row" style={styles.header}>
      <Box direction="row" gap={3} style={styles.rowLead}>
        {icon !== undefined && <SymbolIcon name={icon} tone="textSecondary" />}
        <Text variant="body">{label}</Text>
      </Box>
      {onPress !== undefined && (
        // The chevron is a decorative affordance: the row's own button role
        // already conveys "navigates", so hide the glyph from the a11y tree
        // (otherwise a screen reader announces a bare "chevron"). Tests target
        // it by testID instead of a label.
        <Box
          testID="settings-row-chevron"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <SymbolIcon name="chevron.right" tone="textSecondary" />
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
