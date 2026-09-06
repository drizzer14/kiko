import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import '../../../i18n';

import LanguageSwitch from '.';

describe('LanguageSwitch', () => {
  it('reports the pressed language through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(<LanguageSwitch selected="en" onSelect={onSelect} />);

    await fireEvent.press(getByText('🇺🇦 Українська'));

    expect(onSelect).toHaveBeenCalledWith('uk');
  });

  it('renders both flag+label pills', async () => {
    const { getByText } = await render(<LanguageSwitch selected="en" onSelect={jest.fn()} />);

    expect(getByText('🇬🇧 English')).toBeTruthy();
    expect(getByText('🇺🇦 Українська')).toBeTruthy();
  });

  it('marks the selected language via accessibilityState', async () => {
    const { getByText } = await render(<LanguageSwitch selected="uk" onSelect={jest.fn()} />);

    expect(getByText('🇺🇦 Українська').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('🇬🇧 English').parent?.props.accessibilityState.selected).toBe(false);
  });
});
