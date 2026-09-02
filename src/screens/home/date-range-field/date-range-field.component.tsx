import { type FC, useState } from 'react';
import { Modal, Pressable } from 'react-native';
import type { DateData } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { formatDate } from '../../../dates/format';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import PffCalendar from '../../calendar';
import type { DateRangeFieldProps } from './date-range-field.props';
import { styles } from './date-range-field.styles';

// A single period-marking entry for one calendar day. `color` fills the day;
// `startingDay`/`endingDay` round the span's two ends.
type PeriodMark = { color: string; startingDay?: boolean; endingDay?: boolean };

const pad2 = (value: number): string => value.toString().padStart(2, '0');

// The 'YYYY-MM-DD' key react-native-calendars uses for a marked/pressed day,
// read off the Date in local time (never via toISOString, which shifts to UTC).
const toCalendarKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// Midnight (local) of a Date, dropping any time component so day math is exact.
const atLocalMidnight = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Pull a Date back into the inclusive [floor, ceiling] selectable range, so a
// preselected bound that would land outside the range (e.g. a future-dated
// latest transaction) snaps to the nearest selectable day instead.
const clampToRange = (date: Date, floor: Date, ceiling: Date): Date => {
  if (date < floor) {
    return floor;
  }

  if (date > ceiling) {
    return ceiling;
  }

  return date;
};

// The period `markedDates` map for the current draft: a single day when only the
// start is set, otherwise every day from `from` to `to` inclusive with the ends
// rounded. Empty when nothing is selected.
const buildPeriodMarks = (
  from: Date | null,
  to: Date | null,
  color: string,
): Record<string, PeriodMark> => {
  if (from === null) {
    return {};
  }

  if (to === null) {
    return { [toCalendarKey(from)]: { color, startingDay: true, endingDay: true } };
  }

  const marks: Record<string, PeriodMark> = {};
  const startKey = toCalendarKey(from);
  const endKey = toCalendarKey(to);

  for (
    const cursor = atLocalMidnight(from);
    cursor <= atLocalMidnight(to);
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const key = toCalendarKey(cursor);
    marks[key] = { color, startingDay: key === startKey, endingDay: key === endKey };
  }

  return marks;
};

// The field's summary text for an active range: both bounds, or one open-ended
// bound. Every date is DD.MM.YYYY (see formatDate); an en dash joins two bounds.
const activeRangeLabel = (from: Date | null, to: Date | null): string => {
  if (from !== null && to !== null) {
    return `${formatDate(from)} – ${formatDate(to)}`;
  }

  if (from !== null) {
    return `From ${formatDate(from)}`;
  }

  if (to !== null) {
    return `Until ${formatDate(to)}`;
  }

  return '';
};

/** A single date-range field that opens a one-calendar range-selection sheet. */
const DateRangeField: FC<DateRangeFieldProps> = ({
  dateFrom,
  dateTo,
  minDate,
  maxDate,
  onApply,
  onClear,
}) => {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(dateFrom);
  const [draftTo, setDraftTo] = useState<Date | null>(dateTo);

  const hasActiveRange = dateFrom !== null || dateTo !== null;

  // With no active range the field displays the full transaction span but does
  // not filter; an active range shows its own bounds.
  const fieldLabel = hasActiveRange
    ? activeRangeLabel(dateFrom, dateTo)
    : `${formatDate(minDate)} – ${formatDate(maxDate)}`;

  // The inclusive *selectable* range, distinct from the display span above: the
  // earliest a user may pick is the earliest-data day (`minDate`, which the Home
  // screen sets to the earliest transaction's day, or today when there are no
  // transactions); the latest is today, so future days are never selectable.
  // These bounds are forwarded to PffCalendar as 'YYYY-MM-DD' min/max so
  // react-native-calendars greys out the out-of-range days; `handleDayPress`
  // also rejects them at selection time as a belt-and-suspenders guard.
  const selectableFloor = atLocalMidnight(minDate);
  const selectableCeiling = atLocalMidnight(new Date());

  // Seed the draft each time the sheet opens: from the active range if one is
  // set, otherwise from the displayed full span so the shown selection is
  // immediately appliable without a fresh tap.
  const openModal = (): void => {
    if (hasActiveRange) {
      setDraftFrom(dateFrom);
      setDraftTo(dateTo);
    } else {
      setDraftFrom(clampToRange(minDate, selectableFloor, selectableCeiling));
      setDraftTo(clampToRange(maxDate, selectableFloor, selectableCeiling));
    }

    setOpen(true);
  };

  // First tap (or a tap after a complete range) starts a fresh selection; the
  // second tap closes the range, ordering the two so from <= to always holds —
  // a tap before the current start becomes the new start.
  const handleDayPress = (day: DateData): void => {
    const picked = new Date(day.year, day.month - 1, day.day);

    // A day outside the selectable range (future, or earlier than the first
    // transaction) is ignored so it can never enter the draft or be applied.
    if (picked < selectableFloor || picked > selectableCeiling) {
      return;
    }

    if (draftFrom === null || draftTo !== null) {
      setDraftFrom(picked);
      setDraftTo(null);

      return;
    }

    const pickedIsEarlier = picked.getTime() < draftFrom.getTime();
    setDraftFrom(pickedIsEarlier ? picked : draftFrom);
    setDraftTo(pickedIsEarlier ? draftFrom : picked);
  };

  // Commit the currently-shown selection directly — a lone start becomes a
  // same-day range so a preselected day applies without needing a second tap.
  const handleApply = (): void => {
    onApply(draftFrom, draftTo ?? draftFrom);
    setOpen(false);
  };

  const handleClear = (): void => {
    setDraftFrom(null);
    setDraftTo(null);
    onClear();
    setOpen(false);
  };

  const marks = buildPeriodMarks(draftFrom, draftTo, theme.colors.accent);

  return (
    <Box gap={1}>
      <Pressable accessibilityRole="button" accessibilityLabel="Date range" onPress={openModal}>
        <Box direction="row" gap={2} style={styles.field}>
          <SymbolIcon name="calendar" size={18} tone="textPrimary" />

          <Text variant="body" tone="textPrimary">
            {fieldLabel}
          </Text>
        </Box>
      </Pressable>

      {open && (
        <Modal transparent visible animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            <Box gap={4} style={styles.sheet(insets.bottom)} onStartShouldSetResponder={() => true}>
              <Text variant="heading">Date Range</Text>

              <PffCalendar
                testID="date-range-calendar"
                markingType="period"
                markedDates={marks}
                minDate={toCalendarKey(selectableFloor)}
                maxDate={toCalendarKey(selectableCeiling)}
                onDayPress={handleDayPress}
              />

              <Box direction="row" gap={3} style={styles.actions}>
                <Button variant="secondary" fullWidth={false} onPress={handleClear}>
                  Clear
                </Button>

                <Button fullWidth={false} onPress={handleApply}>
                  Apply
                </Button>
              </Box>
            </Box>
          </Pressable>
        </Modal>
      )}
    </Box>
  );
};

export default DateRangeField;
