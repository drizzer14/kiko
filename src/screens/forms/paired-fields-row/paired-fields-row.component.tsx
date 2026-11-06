import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import { useWindowDimensions, View } from 'react-native';

import { styles } from './paired-fields-row.styles';
import type { PairedFieldsRowProps } from './paired-fields-row.props';

// The font scale from which two paired fields stack: iOS's first accessibility text size, AX1.
// Apple's type-size table gives the body style 17 pt at the default size and 28 pt at AX1, so
// 28 / 17; the largest regular size, xxxLarge, is 23 / 17 (about 1.35) and stays a row.
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
