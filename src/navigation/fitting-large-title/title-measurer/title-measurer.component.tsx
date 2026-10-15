import type { FC } from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';

import { titleFits } from '../title-fit';

import { styles } from './title-measurer.styles';
import type { TitleMeasurerProps } from './title-measurer.props';

/**
 * Lays the title out invisibly in the large-title font at the width the native large title has,
 * and reports whether it stays on one line. It reads the layout pass, so it measures the real
 * glyphs. Mount it with a `key` of the title and the width: a layout event only fires when the
 * frame changes, and a fresh mount always fires one.
 */
const TitleMeasurer: FC<TitleMeasurerProps> = ({ title, availableWidth, onFitChange }) => {
  const { theme } = useUnistyles();

  return (
    <View
      testID="title-measurer"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.container(availableWidth)}
      onLayout={(event) =>
        onFitChange(
          titleFits(event.nativeEvent.layout.height, theme.typography.largeTitle.lineHeight),
        )
      }
    >
      <Text variant="largeTitle">{title}</Text>
    </View>
  );
};

export default TitleMeasurer;
