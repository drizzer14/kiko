import { Pressable } from 'react-native';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../box';
import Text from '../text';

import { styles } from './segmented-control.styles';
import type { SegmentedControlProps } from './segmented-control.props';

// Restores the 44pt HIG touch target on top of the 24pt VISIBLE segment (F3
// fix round 2, M1 — the round 1 value sat on the wrong base, the 24pt
// segment, not the 32pt track, only reaching 36pt): (44 - 24) / 2 = 10pt top
// and bottom.
const SEGMENT_HIT_SLOP = { top: 10, bottom: 10 } as const;

/**
 * A JS `UISegmentedControl` per Apple's iOS Human Interface Guidelines
 * (https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
 * — no segmented-control native library is a dependency of this app.
 *
 * Accessibility (F3 fix round 2, M4): each segment keeps
 * `accessibilityRole="button"` with `accessibilityState={{ selected }}` —
 * NOT `"tab"`/`"tablist"`, which RN 0.87 maps to no accessibility trait on
 * iOS (`RCTViewManager`/Fabric's `accessibilityPropsConversions` only map
 * `"tabbar"`; a plain `"button"` is the trait VoiceOver needs to announce
 * "can be activated", the same trait native `UISegmentedControl` segments
 * carry). The group's own `accessibilityLabel` and each segment's position
 * (a translated "N of M" string, `common.segmentPosition`) are folded into
 * that segment's own `accessibilityHint`, since a non-`accessible` container
 * gives VoiceOver nothing to read on its own. VoiceOver behavior should
 * still be confirmed on a real device — Jest can only assert prop values.
 */
const SegmentedControl = <Option extends string>({
  options,
  selected,
  onSelect,
  labels,
  accessibilityLabel,
  testID,
}: SegmentedControlProps<Option>): ReactElement => {
  const { t } = useTranslation();

  return (
    <Box style={styles.track} testID={testID}>
      {options.map((option, index) => {
        const isSelected = selected === option;
        const label = labels?.[option] ?? option;
        const position = t('common.segmentPosition', { index: index + 1, count: options.length });

        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            accessibilityHint={`${accessibilityLabel}, ${position}`}
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
              style={[styles.label, isSelected && styles.selectedLabel]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </Box>
  );
};

export default SegmentedControl;
