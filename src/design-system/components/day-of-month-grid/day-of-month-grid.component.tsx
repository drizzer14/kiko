import type { FC } from 'react';
import { Pressable } from 'react-native';
import { deriveFieldTestID } from '@kiko/design-system/derive-field-test-id';

import Box from '../box';
import Text from '../text';
import FieldLabel from '../field-label';

import { styles } from './day-of-month-grid.styles';
import type { DayOfMonthGridProps } from './day-of-month-grid.props';

const LONGEST_MONTH_DAYS = 31;

const DAYS_OF_MONTH = Array.from({ length: LONGEST_MONTH_DAYS }, (_unused, index) => index + 1);

// Every day stays one tap away in context, as the iOS Reminders "Each" grid
// does, instead of a sheet that hides the other 30 values. A non-accessible
// container gives VoiceOver nothing to read, so each day carries the group
// name as its hint.
const DayOfMonthGrid: FC<DayOfMonthGridProps> = ({ label, selected, onSelect, testID }) => {
  return (
    <Box gap={1}>
      <FieldLabel label={label} />

      <Box style={styles.grid} accessibilityLabel={label} testID={testID}>
        {DAYS_OF_MONTH.map((day) => {
          const isSelected = day === selected;

          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={String(day)}
              accessibilityHint={label}
              onPress={() => onSelect(day)}
              style={styles.cell}
              testID={deriveFieldTestID(testID, `option-${day}`)}
            >
              <Box style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}>
                <Text variant="body" tone={isSelected ? 'onAccent' : 'textPrimary'}>
                  {day}
                </Text>
              </Box>
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
};

export default DayOfMonthGrid;
