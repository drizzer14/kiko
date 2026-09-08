import { render } from '@testing-library/react-native';

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
});
