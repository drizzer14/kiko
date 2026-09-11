// The subset of react-native-calendars' custom-header prop bag this header
// reads. The library hands `customHeader` the full CalendarHeader props, but
// only the visible month and the month-stepping callback are needed here.

// react-native-calendars passes the visible month as an XDate, whose
// getMonth / getFullYear accessors mirror the built-in Date. Typed as this
// minimal shape so no direct dependency on xdate's types is needed.
type CalendarMonth = {
  getMonth: () => number;
  getFullYear: () => number;
};

export type CalendarHeaderProps = {
  // The month currently shown by the calendar (library-provided); optional
  // because the library types `customHeader` loosely. Falls back to today.
  month?: CalendarMonth;
  // Steps the visible month by `count` months (library-provided): +1/-1 for one
  // month, +12/-12 for a full year forward/back.
  addMonth?: (count: number) => void;
};
