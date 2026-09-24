import { Pressable } from 'react-native';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../box';
import Text from '../text';

import { styles } from './segmented-control.styles';
import type { SegmentedControlProps } from './segmented-control.props';

/**
 * A JS `UISegmentedControl` per Apple's iOS Human Interface Guidelines
 * (https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
 * — no segmented-control native library is a dependency of this app.
 *
 * Touch target (F3 fix round 3, N6): each segment `Pressable` is a REAL
 * 44pt-tall layout box — not a shorter box grown via `hitSlop` (fix round
 * 2's approach), which RN 0.87's Fabric hit-test never honors outside a
 * non-overflowing parent's own bounds. The shorter, native-matching
 * visible track/pill render as absolutely-positioned decorative layers
 * underneath (`segmented-control.styles.ts`) — see that file for the
 * exact geometry.
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
    <Box style={styles.container} testID={testID}>
      <Box
        style={styles.trackFill}
        pointerEvents="none"
        testID={testID ? `${testID}-track` : undefined}
      />

      <Box style={styles.row}>
        {options.map((option, index) => {
          const isSelected = selected === option;
          const label = labels?.[option] ?? option;
          const position = t('common.segmentPosition', {
            index: index + 1,
            count: options.length,
          });

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={label}
              accessibilityHint={`${accessibilityLabel}, ${position}`}
              onPress={() => onSelect(option)}
              style={styles.segment}
              testID={testID ? `${testID}-option-${option}` : undefined}
            >
              {isSelected && <Box style={styles.segmentSelected} pointerEvents="none" />}

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
    </Box>
  );
};

export default SegmentedControl;
