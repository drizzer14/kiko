import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import '../../../i18n';

import AppearanceToggles from './appearance-toggles.component';

describe('AppearanceToggles', () => {
  it('follow ON disables the dark switch and reflects the resolved scheme', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <AppearanceToggles appearance="system" onChange={onChange} />,
    );

    const dark = getByTestId('appearance-toggle-dark');
    expect(dark.props.accessibilityState.disabled).toBe(true);
    // Jest mock resolves themeName to 'dark' -> reflected ON.
    expect(dark.props.value).toBe(true);
  });

  it('turning Follow OFF pins the currently reflected scheme', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <AppearanceToggles appearance="system" onChange={onChange} />,
    );

    fireEvent(getByTestId('appearance-toggle-follow'), 'valueChange', false);
    // Reflected scheme was dark -> pin 'dark'.
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('pinned dark enables the dark switch; toggling it OFF pins light', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <AppearanceToggles appearance="dark" onChange={onChange} />,
    );

    const dark = getByTestId('appearance-toggle-dark');
    expect(dark.props.accessibilityState.disabled).toBe(false);
    fireEvent(dark, 'valueChange', false);
    expect(onChange).toHaveBeenCalledWith('light');
  });
});
