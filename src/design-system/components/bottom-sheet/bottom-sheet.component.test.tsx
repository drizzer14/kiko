import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import '../../unistyles';
import { darkTheme } from '../../theme';
import BottomSheet from '.';

// A device with a home indicator reports a non-zero bottom safe-area inset. The
// sheet renders inside a Modal (outside any SafeAreaView), so it must add that
// inset to its own bottom padding — this is the drift/A2 regression the shared
// primitive exists to prevent. Override the package's zero-inset global mock
// with a concrete inset so the padding assertion actually proves the inset is
// added (a zero inset would make "added" and "dropped" indistinguishable).
const MOCK_BOTTOM_INSET = 34;
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: MOCK_BOTTOM_INSET, left: 0 }),
  };
});

// The single base padding step the sheet keeps around its content (spacing(4)).
const SHEET_BASE_PADDING = 16;
const SHEET_TEST_ID = 'sheet-card';

describe('BottomSheet', () => {
  it('renders its children while visible', async () => {
    const { getByText } = await render(
      <BottomSheet visible onDismiss={jest.fn()}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(getByText('sheet body')).toBeTruthy();
  });

  it('renders nothing while not visible', async () => {
    const { queryByText } = await render(
      <BottomSheet visible={false} onDismiss={jest.fn()}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(queryByText('sheet body')).toBeNull();
  });

  it('dismisses when the scrim behind the sheet is tapped', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={onDismiss} backdropTestID="sheet-backdrop">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    fireEvent.press(getByTestId('sheet-backdrop'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('owns the bottom safe-area inset on top of its single base padding step', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    // The sheet's bottom padding is the base step PLUS the home-indicator inset,
    // never one without the other (dropping the inset is bug A2; the base step
    // is what the four sheets previously drifted on, 4 vs 6 vs missing).
    expect(sheetStyle.paddingBottom).toBe(SHEET_BASE_PADDING + MOCK_BOTTOM_INSET);
    expect(sheetStyle.paddingTop).toBe(SHEET_BASE_PADDING);
    expect(sheetStyle.paddingHorizontal).toBe(SHEET_BASE_PADDING);
  });

  it('labels the scrim as a dismiss button when a backdrop label is given', async () => {
    const { getByLabelText } = await render(
      <BottomSheet visible onDismiss={jest.fn()} backdropAccessibilityLabel="Dismiss picker">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(getByLabelText('Dismiss picker').props.accessibilityRole).toBe('button');
  });

  it('caps the sheet height when maxHeight is set so tall content scrolls within', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID} maxHeight="80%">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    expect(sheetStyle.maxHeight).toBe('80%');
  });

  // The scrim is a frosted dim, not opaque black: `theme.colors.scrim` (a
  // translucent black), never the opaque `background` token. Jest always
  // exercises the non-liquid-glass fallback branch (`@callstack/liquid-glass`
  // is globally mocked with `isLiquidGlassSupported: false` — see
  // `jest/setup.js`), so this asserts the fallback `View`'s own dim; the real
  // `LiquidGlassView` blur branch only renders on an iOS 26+ device.
  it('dims the scrim with the translucent scrim token, never opaque black', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} backdropTestID="sheet-backdrop">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const backdropChildren = getByTestId('sheet-backdrop').props.children;
    const backdropChild = Array.isArray(backdropChildren) ? backdropChildren[0] : backdropChildren;
    const childStyle = StyleSheet.flatten(backdropChild.props.style);

    expect(childStyle.backgroundColor).toBe(darkTheme.colors.scrim);
    expect(childStyle.backgroundColor).not.toBe(darkTheme.colors.background);
  });
});
