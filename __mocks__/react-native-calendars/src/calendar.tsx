// Manual mock for the deep `react-native-calendars/src/calendar` specifier
// KikoCalendar imports, picked up by Jest automatically with no
// `jest.mock()` call. The real Calendar loads untranspiled ESM dependencies
// (react-native-swipe-gestures) and gives a test no direct handle on a day
// tap, so it renders as a plain View that keeps every prop: a test reads
// `testID`, `markedDates`, and the rest, and calls `onDayPress` directly.
import { View } from 'react-native';

export default View;
