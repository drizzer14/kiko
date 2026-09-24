import { Pressable } from 'react-native';
import type { ReactElement } from 'react';

import Box from '../box';
import Text from '../text';

import { styles } from './segmented-control.styles';
import type { SegmentedControlProps } from './segmented-control.props';

// Restores the 44pt HIG touch target on top of the ~32pt VISIBLE track (F3
// fix round 1, M1): (44 - 32) / 2 = 6pt top and bottom.
const SEGMENT_HIT_SLOP = { top: 6, bottom: 6 } as const;

/**
 * A JS `UISegmentedControl` per Apple's iOS Human Interface Guidelines
 * (https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
 * — no segmented-control native library is a dependency of this app.
 */
const SegmentedControl = <Option extends string>({
  options,
  selected,
  onSelect,
  labels,
  accessibilityLabel,
  testID,
}: SegmentedControlProps<Option>): ReactElement => {
  return (
    <Box
      style={styles.track}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {options.map((option, index) => {
        const isSelected = selected === option;

        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            // VoiceOver reads this as the segment's position within the
            // group ("1 of 2") — native UISegmentedControl announces the
            // same (F3 fix round 1, M4).
            accessibilityValue={{ text: `${index + 1} / ${options.length}` }}
            hitSlop={SEGMENT_HIT_SLOP}
            onPress={() => onSelect(option)}
            style={[styles.segment, isSelected && styles.segmentSelected]}
            testID={testID ? `${testID}-option-${option}` : undefined}
          >
            <Text
              variant="body"
              tone={isSelected ? 'textPrimary' : 'textSecondary'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={isSelected ? styles.selectedLabel : styles.label}
            >
              {labels?.[option] ?? option}
            </Text>
          </Pressable>
        );
      })}
    </Box>
  );
};

export default SegmentedControl;
