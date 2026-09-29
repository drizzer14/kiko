import type { FC } from 'react';
import { Pressable } from 'react-native';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import SymbolIcon from '@kiko/design-system/components/symbol';

import { styles } from './settings-row.styles';
import { chevronSize } from './settings-row.chevron';
import type { SettingsRowProps } from './settings-row.props';

// A single full-width row inside a Settings GlassSurface card: an optional
// leading icon, a label, an optional `trailing` control, a chevron on a
// navigating row (e.g. the Categories row), and optional `children` as a body.
// On a static row the body is full width below the label (e.g. the inline
// base-currency switch); on a navigating row it wraps beside the control and
// chevron, which center on it (e.g. a reminder card). This is the ONE row
// shape every Settings card is built from, so adding another setting is a
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

  const lead = (
    <Box direction="row" gap={3} style={styles.rowLead}>
      {icon !== undefined && <SymbolIcon name={icon} tone="textSecondary" />}
      <Box style={styles.label}>
        <Text variant="body">{label}</Text>
      </Box>
    </Box>
  );

  const end = (
    <>
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
    </>
  );

  const header = (
    <Box direction="row" style={styles.header}>
      {lead}

      {end}
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

  // A tappable row with a body under its label centers its switch and chevron
  // on the whole card, as a UIKit cell centers its accessory view; a row
  // without a body keeps its first-line header layout.
  if (children !== undefined) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} {...props}>
        <Box direction="row" style={styles.centeredEnd}>
          <Box style={styles.body}>
            {lead}

            {children}
          </Box>

          {end}
        </Box>
      </Pressable>
    );
  }

  return (
    <Pressable accessibilityRole="button" onPress={onPress} {...props}>
      {header}
    </Pressable>
  );
};

export default SettingsRow;
