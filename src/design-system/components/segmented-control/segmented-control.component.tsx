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
 * Touch target (F3 fix rounds 3-4): each segment `Pressable` is a REAL
 * layout box at least 44pt tall, with no `hitSlop`. The native-matching
 * 32pt track and 24pt selected pill are absolutely-positioned decorative
 * layers inset from it, and a negative vertical margin keeps the control's
 * layout footprint at the 32pt track. `segmented-control.styles.ts` holds
 * the exact geometry and the RN 0.87 Fabric hit-test reasoning.
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
              {isSelected && (
                <Box
                  style={styles.segmentSelected}
                  pointerEvents="none"
                  testID={testID ? `${testID}-selected` : undefined}
                />
              )}

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
