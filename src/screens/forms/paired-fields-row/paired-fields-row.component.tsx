import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import { useWindowDimensions, View } from 'react-native';
import { STACK_FONT_SCALE } from '@kiko/design-system/stack-font-scale';

import { styles } from './paired-fields-row.styles';
import type { PairedFieldsRowProps } from './paired-fields-row.props';

// Two fields side by side in one row, and one above the other in the same order at an
// accessibility text size, where half the width holds too little. `DateTimeRow` stays a row at
// every size, so it does not lay Date and Time this way.
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
