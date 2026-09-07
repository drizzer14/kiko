import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import '../../../i18n';

import AppearanceSwitch from '.';

describe('AppearanceSwitch', () => {
  it('reports the pressed appearance through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(<AppearanceSwitch selected="system" onSelect={onSelect} />);

    await fireEvent.press(getByText('Dark'));

    expect(onSelect).toHaveBeenCalledWith('dark');
  });

  it('renders all three appearance pills', async () => {
    const { getByText } = await render(<AppearanceSwitch selected="system" onSelect={jest.fn()} />);

    expect(getByText('System')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
  });

  it('marks the selected appearance via accessibilityState', async () => {
    const { getByText } = await render(<AppearanceSwitch selected="light" onSelect={jest.fn()} />);

    expect(getByText('Light').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('System').parent?.props.accessibilityState.selected).toBe(false);
  });
});
