import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { CalendarHeaderProps } from './calendar-header.props';
import { styles } from './calendar-header.styles';

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

// Sunday-first, matching react-native-calendars' default firstDay (0) and the
// column order of the day grid this header sits above.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// Replaces react-native-calendars' default header. The library hands it the
// visible month and an `addMonth(count)` navigator; the double-chevron controls
// step a full year (±12), the single-chevron controls one month (±1). Because a
// custom header also owns the weekday labels the default header would render,
// this re-renders them below the title so the day-of-week row is preserved.
const CalendarHeader: FC<CalendarHeaderProps> = ({ month, addMonth }) => {
  const { t } = useTranslation();
  const visible = month ?? new Date();
  const title = `${t(`calendar.month.${MONTH_KEYS[visible.getMonth()]}`)} ${visible.getFullYear()}`;
  const step = (count: number) => () => addMonth?.(count);

  return (
    <Box style={styles.header}>
      <Box direction="row" gap={2} style={styles.titleRow}>
        <Box direction="row" gap={3} style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('calendar.previousYear')}
            hitSlop={8}
            onPress={step(-12)}
          >
            <SymbolIcon name="chevron.left.2" size={16} tone="textPrimary" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('calendar.previousMonth')}
            hitSlop={8}
            onPress={step(-1)}
          >
            <SymbolIcon name="chevron.left" size={16} tone="textPrimary" />
          </Pressable>
        </Box>

        <Box style={styles.titleColumn}>
          <Text variant="heading">{title}</Text>
        </Box>

        <Box direction="row" gap={3} style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('calendar.nextMonth')}
            hitSlop={8}
            onPress={step(1)}
          >
            <SymbolIcon name="chevron.right" size={16} tone="textPrimary" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('calendar.nextYear')}
            hitSlop={8}
            onPress={step(12)}
          >
            <SymbolIcon name="chevron.right.2" size={16} tone="textPrimary" />
          </Pressable>
        </Box>
      </Box>

      <Box direction="row" style={styles.weekRow}>
        {WEEKDAY_KEYS.map((day) => (
          <Box key={day} style={styles.weekday}>
            <Text variant="caption" tone="textSecondary">
              {t(`calendar.weekday.${day}`)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default CalendarHeader;
