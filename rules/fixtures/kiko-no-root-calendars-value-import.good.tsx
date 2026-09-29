// Semgrep fixture (NEGATIVE): kiko-no-root-calendars-value-import must report
// nothing here. A type-only import from the root of react-native-calendars is
// erased at build time, and the deep Calendar path bundles only the calendar.
import type { DateData } from 'react-native-calendars';
import Calendar from 'react-native-calendars/src/calendar';

export const DeepCalendar = Calendar;
export type RootDateData = DateData;
