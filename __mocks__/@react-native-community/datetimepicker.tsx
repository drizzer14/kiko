// Manual mock for `@react-native-community/datetimepicker`, picked up
// automatically by Jest for every test (no `jest.mock(...)` call needed — see
// https://jestjs.io/docs/manual-mocks#mocking-node-modules).
//
// The real package resolves to a native host view (`RNDateTimePicker`) with no
// software renderer under react-test-renderer, and its "react-native" export
// condition ships raw TypeScript/Flow source that Jest's RN preset does not
// transform. This mock renders the picker as a plain `View` that preserves
// `testID` and every other prop, so a component test can query it by testID and
// drive its `onChange(event, date)` callback with
// `fireEvent(node, 'change', event, date)`.

import type { ReactNode } from 'react';
import { View } from 'react-native';

type DateTimePickerMockProps = Record<string, unknown>;

const DateTimePicker = (props: DateTimePickerMockProps): ReactNode => {
  return <View {...props} />;
};

export default DateTimePicker;
