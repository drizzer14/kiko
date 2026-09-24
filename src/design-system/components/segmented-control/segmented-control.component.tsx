import type { ReactElement } from 'react';
import { Pressable } from 'react-native';

import Box from '../box';
import Text from '../text';
import FieldLabel from '../field-label';

import { styles } from './segmented-control.styles';
import type { SegmentedControlProps } from './segmented-control.props';

// The vertical hitSlop that restores the iOS HIG 44pt minimum touch target
// on top of the control's shorter VISIBLE height (`SEGMENT_MIN_HEIGHT`,
// segmented-control.styles.ts) — the same visible-short/hitSlop-restored
// split `Button`'s own `size="small"` documents (`button.component.tsx`'s
// `SMALL_HIT_SLOP`): (44 - 36) / 2 = 4pt top and bottom.
const SEGMENT_HIT_SLOP = { top: 4, bottom: 4 } as const;

/**
 * The shared design-system segmented control — a JS implementation of
 * Apple's iOS `UISegmentedControl`, per the Human Interface Guidelines:
 * https://developer.apple.com/design/human-interface-guidelines/segmented-controls
 * ("Segmented controls let people select an option from a set of two or
 * more, mutually exclusive choices... segmented controls are usually
 * confined to a fixed width").
 *
 * No segmented-control NATIVE library is a dependency of this app (checked
 * `package.json` at F3 item 9) and adding one only to gain this one control
 * was judged not worth a new native dependency, so this renders the same
 * visual/interaction contract in plain `Pressable`/`Box`/`Text`: a rounded
 * track one elevation step above the screen background, holding N equal-
 * width segments, with the SELECTED segment raised to the next elevation
 * step (`surfaceHigh`) — the OLED "elevation via translucent overlay" scale
 * this app's dark theme already uses everywhere else (see
 * kiko-design-system's "Dark-only theme" section), rather than the app's
 * OTHER (filled-accent) selection vocabulary OptionPills/ChipRow/
 * SelectableRow use — a segmented control reads as its own distinct iOS
 * control, not another chip row.
 *
 * This SUPERSEDES `ChipRow` for the statement-import/column-mapping screens'
 * amount-mode and currency-mode selectors (F3 item 9) — both are a true
 * two-way MODE toggle (not a short code/label multi-select), the case this
 * component targets. `ChipRow` remains the compact short-code/label picker
 * for other fields (encoding, delimiter, decimal separator) — see
 * `kiko-statement-import`'s "Screen layout" section for the distinction.
 */
const SegmentedControl = <Option extends string>({
  options,
  selected,
  onSelect,
  label,
  required,
  labels,
  disabled = false,
  testID,
}: SegmentedControlProps<Option>): ReactElement => {
  return (
    <Box gap={1} testID={testID}>
      {label !== undefined && <FieldLabel label={label} required={required} />}

      <Box style={[styles.track, disabled && styles.disabled]}>
        {options.map((option) => {
          const isSelected = selected === option;

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}
              disabled={disabled}
              hitSlop={SEGMENT_HIT_SLOP}
              onPress={() => onSelect(option)}
              style={[styles.segment, isSelected && styles.segmentSelected]}
              testID={testID ? `${testID}-option-${option}` : undefined}
            >
              <Text variant="body" tone={isSelected ? 'textPrimary' : 'textSecondary'}>
                {labels?.[option] ?? option}
              </Text>
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
};

export default SegmentedControl;
