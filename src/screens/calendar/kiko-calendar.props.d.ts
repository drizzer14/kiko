import type { CalendarProps, DateData } from 'react-native-calendars';

// The wrapper forwards only the props that differ between the two date sheets;
// theming, fixed height, and the year-jump header are applied internally. Marks,
// marking type, testID and initial date reuse react-native-calendars' own prop
// types so the contract stays in lockstep with the library.
export type KikoCalendarProps = Pick<
  CalendarProps,
  'testID' | 'markedDates' | 'markingType' | 'initialDate' | 'minDate' | 'maxDate'
> & {
  // Reports the pressed day; mirrors react-native-calendars' onDayPress.
  onDayPress: (day: DateData) => void;
};
