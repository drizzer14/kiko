import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import { useWindowDimensions, View } from 'react-native';

import { styles } from './paired-fields-row.styles';
import type { PairedFieldsRowProps } from './paired-fields-row.props';

// The font scale from which two paired fields stack. React Native's own table
// (`RCTUtils.mm`) maps the largest regular text size, xxxLarge, to 1.353, which stays a row, and
// the first accessibility size, AX1, to 1.786, which stacks. 28 / 17 (about 1.647) lies between
// them, so each side is clear of the threshold by a margin that a rounding of the scale cannot
// cross.
export const STACK_FONT_SCALE = 28 / 17;

// Two fields side by side in one row, as `DateTimeRow` lays Date and Time, and one above the other
// in the same order at an accessibility text size, where half the width holds too little.
const PairedFieldsRow: FC<PairedFieldsRowProps> = ({ first, second }) => {
  const { fontScale } = useWindowDimensions();

  if (fontScale >= STACK_FONT_SCALE) {
    return (
      <>
        {first}
        {second}
      </>
    );
  }

  return (
    <Box direction="row" gap={3}>
      <View style={styles.field}>{first}</View>
      <View style={styles.field}>{second}</View>
    </Box>
  );
};

export default PairedFieldsRow;
