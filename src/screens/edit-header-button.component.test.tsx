import { fireEvent, render } from '@testing-library/react-native';
import '../design-system/unistyles';
import { darkTheme } from '../design-system/theme';
import EditHeaderButton from './edit-header-button.component';

describe('EditHeaderButton', () => {
  it('renders an accent-tinted "Edit" label', async () => {
    const { getByText } = await render(<EditHeaderButton onPress={jest.fn()} />);

    const label = getByText('Edit');
    expect(label).toBeTruthy();
    // A header button carries the system accent inline (not a Text tone token).
    expect(label.props.style.color).toBe(darkTheme.colors.accent);
  });

  it('fires onPress when the button is tapped', async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(<EditHeaderButton onPress={onPress} />);

    await fireEvent.press(getByLabelText('Edit'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
