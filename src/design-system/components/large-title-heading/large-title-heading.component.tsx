import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { type FC, useContext, useLayoutEffect } from 'react';

import Text from '../text';

import { styles } from './large-title-heading.styles';
import { LargeTitleHeadingContext } from './large-title-heading.context';

// Both scrollables that host the heading (`Screen`'s scroll mode and a bleed-top list) pad their
// first child by this step, so the heading's bottom edge is its height plus the padding.
const HOST_TOP_PADDING_STEP = 4;

/**
 * The screen's full title as the first scroll content, for a title too long for one line of the
 * native large title. It looks like that large title but wraps, so nothing is cut. Renders
 * nothing while the native large title shows the title.
 */
const LargeTitleHeading: FC = () => {
  const heading = useContext(LargeTitleHeadingContext);
  const { theme } = useUnistyles();
  const onHostedChange = heading?.onHostedChange;

  // A layout effect, so the layout learns of the heading before the first frame paints and the
  // title is never on screen twice.
  useLayoutEffect(() => {
    if (onHostedChange === undefined) {
      return;
    }

    onHostedChange(true);

    return () => onHostedChange(false);
  }, [onHostedChange]);

  if (heading === undefined) {
    return null;
  }

  return (
    <View
      testID="large-title-heading"
      // The bar shows the title once this has scrolled under it; VoiceOver reads it once.
      accessibilityElementsHidden={heading.scrolled}
      importantForAccessibility={heading.scrolled ? 'no-hide-descendants' : 'auto'}
      style={styles.heading}
      onLayout={(event) => {
        heading.headingBottom.current =
          event.nativeEvent.layout.height + theme.spacing(HOST_TOP_PADDING_STEP);
      }}
    >
      <Text variant="largeTitle" accessibilityRole="header">
        {heading.title}
      </Text>
    </View>
  );
};

export default LargeTitleHeading;
