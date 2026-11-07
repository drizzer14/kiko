import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import AppearanceSwitch from '.';

describe('AppearanceSwitch', () => {
  it('reports the pressed mode through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(<AppearanceSwitch selected="system" onSelect={onSelect} />);

    await fireEvent.press(getByText('Light'));

    expect(onSelect).toHaveBeenCalledWith('light');
  });

  it('renders the System, Light and Dark pills in that order', async () => {
    const { getAllByText } = await render(
      <AppearanceSwitch selected="system" onSelect={jest.fn()} />,
    );

    expect(getAllByText(/^(System|Light|Dark)$/).map((pill) => pill.props.children)).toEqual([
      'System',
      'Light',
      'Dark',
    ]);
  });

  it('marks the selected mode via accessibilityState', async () => {
    const { getByText } = await render(<AppearanceSwitch selected="dark" onSelect={jest.fn()} />);

    expect(getByText('Dark').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('System').parent?.props.accessibilityState.selected).toBe(false);
    expect(getByText('Light').parent?.props.accessibilityState.selected).toBe(false);
  });
});
