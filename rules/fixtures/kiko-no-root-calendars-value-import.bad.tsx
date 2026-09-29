// Semgrep fixture (POSITIVE): kiko-no-root-calendars-value-import MUST report
// a finding on every pinned line below. Never "fix" this file — see
// kiko-design-system's "Calendar import path". The second import sits below a
// statement so the import-order check, which reads only the leading header,
// does not ask to merge the two root imports into one.
// EXPECT-FINDING
import { Calendar } from 'react-native-calendars';

export const RootCalendar = Calendar;

// EXPECT-FINDING
import {
  LocaleConfig,
  type DateData,
} from 'react-native-calendars';

export const RootLocaleConfig = LocaleConfig;
export type RootDateData = DateData;
