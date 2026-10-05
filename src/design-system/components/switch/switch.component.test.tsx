import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import Switch from './switch.component';

describe('Switch', () => {
  it('renders the thumb in onAccent (white on both schemes)', async () => {
    const { getByTestId } = await render(
      <Switch value onValueChange={() => {}} testID="switch-under-test" />,
    );

    // RN's `Switch` forwards `thumbColor` to the native `RCTSwitch` host
    // node under the platform-transformed name `thumbTintColor` — this is
    // the actual resolved value reaching the native view.
    const thumbColor = getByTestId('switch-under-test').props.thumbTintColor;

    expect(thumbColor).toBe(darkTheme.colors.onAccent);
  });

  it('names a label-less toggle for VoiceOver', async () => {
    const { getByLabelText } = await render(
      <Switch value onValueChange={() => {}} accessibilityLabel="Reminder on" />,
    );

    expect(getByLabelText('Reminder on').props.value).toBe(true);
  });

  // A long label ("Follow system setting") would overflow past the toggle
  // instead of wrapping, because RN's `flexShrink` defaults to 0. Jest
  // cannot lay out pixels, so this pins the style contract: a `flexShrink: 1`
  // label box, and a row that centers the toggle on the label.
  it('lets a long label shrink to wrap, and centers the toggle on it', async () => {
    const { getByText } = await render(
      <Switch value onValueChange={() => {}} label="Follow system setting" />,
    );

    const label = getByText('Follow system setting');

    const shrinkable = ancestorWithStyle(label, 'flexShrink');
    expect(StyleSheet.flatten(shrinkable.props.style).flexShrink).toBe(1);

    const row = ancestorWithStyle(label, 'alignItems');
    expect(StyleSheet.flatten(row.props.style).alignItems).toBe('center');
  });
});
