import type { TFunction } from 'i18next';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';
import type { DateData } from 'react-native-calendars';
import { useUnistyles } from 'react-native-unistyles';

import { formatDate } from '../../../dates/format';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import KikoCalendar from '../../calendar';

import type { DateRangeFieldProps } from './date-range-field.props';
import { styles } from './date-range-field.styles';
import { boundToMove } from './nearer-bound';

// A single period-marking entry for one calendar day. `color` fills the day;
// `startingDay`/`endingDay` round the span's two ends. `selected: true` is
// always set (every day this builds a mark for IS the selection) — without
// it, react-native-calendars' PeriodDay never applies `selectedDayTextColor`
// to the label (see calendar/day/period/index.js: the on-accent text color
// only comes from `marking.selected`, not from the fill color alone), so a
// day that is both today and inside the range keeps `todayTextColor`
// (accent-blue) over the accent-blue fill — invisible. Marking `selected`
// makes that same accent-on-accent day fall back to the on-accent contrast
// color instead, matching KikoCalendar's `selectedDayTextColor` theme token.
type PeriodMark = { color: string; startingDay?: boolean; endingDay?: boolean; selected: true };

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
    return { [toCalendarKey(from)]: { color, startingDay: true, endingDay: true, selected: true } };
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
    marks[key] = {
      color,
      startingDay: key === startKey,
      endingDay: key === endKey,
      selected: true,
    };
  }

  return marks;
};

// The field's summary text for an active range: both bounds, or one open-ended
// bound. Every date is DD.MM.YYYY (see formatDate); an en dash joins two bounds.
const activeRangeLabel = (from: Date | null, to: Date | null, t: TFunction): string => {
  if (from !== null && to !== null) {
    return `${formatDate(from)} – ${formatDate(to)}`;
  }

  if (from !== null) {
    return t('home.dateRangeField.from', { date: formatDate(from) });
  }

  if (to !== null) {
    return t('home.dateRangeField.until', { date: formatDate(to) });
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(dateFrom);
  const [draftTo, setDraftTo] = useState<Date | null>(dateTo);

  const hasActiveRange = dateFrom !== null || dateTo !== null;

  // With no active range the field displays the full transaction span but does
  // not filter; an active range shows its own bounds.
  const fieldLabel = hasActiveRange
    ? activeRangeLabel(dateFrom, dateTo, t)
    : `${formatDate(minDate)} – ${formatDate(maxDate)}`;

  // The inclusive *selectable* range, distinct from the display span above: the
  // earliest a user may pick is the earliest-data day (`minDate`, which the Home
  // screen sets to the earliest transaction's day, or today when there are no
  // transactions); the latest is today, so future days are never selectable.
  // These bounds are forwarded to KikoCalendar as 'YYYY-MM-DD' min/max so
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

  // A pick moves only the bound nearer to it (by absolute time distance) and
  // leaves the other bound unchanged, so the range extends or shrinks from the
  // side closest to the pick rather than resetting the whole selection. The
  // "which bound moves" decision is the pure `boundToMove` (see nearer-bound.ts);
  // a valid from <= to range can never invert under it.
  const handleDayPress = (day: DateData): void => {
    const picked = new Date(day.year, day.month - 1, day.day);

    // A day outside the selectable range (future, or earlier than the first
    // transaction) is ignored so it can never enter the draft or be applied.
    if (picked < selectableFloor || picked > selectableCeiling) {
      return;
    }

    const bound = boundToMove(
      draftFrom?.getTime() ?? null,
      draftTo?.getTime() ?? null,
      picked.getTime(),
    );

    if (bound === 'from') {
      setDraftFrom(picked);

      return;
    }

    setDraftTo(picked);
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.dateRangeField.label')}
        onPress={openModal}
      >
        <Box direction="row" gap={2} style={styles.field}>
          <SymbolIcon name="calendar" size={18} tone="textPrimary" />

          <Text variant="body" tone="textPrimary">
            {fieldLabel}
          </Text>
        </Box>
      </Pressable>

      {/* `scrollable={false}`: the Clear/Apply row below must stay reachable
          regardless of scroll position (F5 fix requires every sheet's
          overflow to scroll, but never at the cost of hiding its actions), so
          this sheet owns its own inner ScrollView around just the heading +
          calendar rather than the shared one BottomSheet would otherwise wrap
          ALL of children in. */}
      <BottomSheet visible={open} onDismiss={() => setOpen(false)} gap={4} scrollable={false}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="heading">{t('home.dateRangeField.heading')}</Text>

          <KikoCalendar
            testID="date-range-calendar"
            markingType="period"
            markedDates={marks}
            // Open on the ACTIVE range's END bound (its draft `to`, mid-edit)
            // so the most recent month shows first, falling back to the start
            // and then the selectable ceiling — rather than letting
            // react-native-calendars default to the current month: reopening
            // the picker after applying a March–June range showed September
            // with none of its own marks on screen.
            initialDate={toCalendarKey(draftTo ?? draftFrom ?? selectableCeiling)}
            minDate={toCalendarKey(selectableFloor)}
            maxDate={toCalendarKey(selectableCeiling)}
            onDayPress={handleDayPress}
          />
        </ScrollView>

        <Box direction="row" gap={3} style={styles.actions}>
          <Button variant="secondary" size="compact" fullWidth={false} onPress={handleClear}>
            {t('home.dateRangeField.clear')}
          </Button>

          <Button fullWidth={false} onPress={handleApply}>
            {t('home.dateRangeField.apply')}
          </Button>
        </Box>
      </BottomSheet>
    </Box>
  );
};

export default DateRangeField;
