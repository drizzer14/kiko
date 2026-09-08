import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';
import '../../unistyles';
import { darkTheme } from '../../theme';

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

  // A long label ("Follow system setting") previously overflowed past the
  // toggle instead of wrapping, because RN's `flexShrink` defaults to 0. This
  // asserts the STYLE CONTRACT that enables wrapping (not actual pixel
  // wrapping, which Jest cannot lay out): the label sits in a `flexShrink: 1`
  // container, and the row top-aligns to the label's first line rather than
  // vertically centering the toggle against the label's full (once wrapped,
  // multi-line) height.
  it('lets a long label shrink to wrap, and top-aligns the toggle to it', async () => {
    const { getByText } = await render(
      <Switch value onValueChange={() => {}} label="Follow system setting" />,
    );

    const label = getByText('Follow system setting');

    const shrinkable = ancestorWithStyle(label, 'flexShrink');
    expect(StyleSheet.flatten(shrinkable.props.style).flexShrink).toBe(1);

    const row = ancestorWithStyle(label, 'alignItems');
    expect(StyleSheet.flatten(row.props.style).alignItems).toBe('flex-start');
  });
});
