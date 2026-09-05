import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { darkTheme } from '../../../design-system/theme';

import ColorPicker from './color-picker.component';

const { entityColors } = darkTheme.colors;

describe('ColorPicker', () => {
  it('renders a tappable swatch for every entity color', async () => {
    const { getByLabelText } = await render(
      <ColorPicker value={entityColors.white} onSelect={jest.fn()} />,
    );

    for (const name of Object.keys(entityColors)) {
      expect(getByLabelText(`Color ${name}`)).toBeTruthy();
    }
  });

  it('marks the swatch whose hex equals value as selected, and no other', async () => {
    const { getByLabelText } = await render(
      <ColorPicker value={entityColors.yellow} onSelect={jest.fn()} />,
    );

    expect(getByLabelText('Color yellow').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Color white').props.accessibilityState.selected).toBe(false);
  });

  it('reports the tapped swatch hex through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByLabelText } = await render(
      <ColorPicker value={entityColors.white} onSelect={onSelect} />,
    );

    await fireEvent.press(getByLabelText('Color violet'));

    expect(onSelect).toHaveBeenCalledWith(entityColors.violet);
  });

  it('renders an optional caption above the swatches', async () => {
    const { getByText } = await render(
      <ColorPicker value={entityColors.white} onSelect={jest.fn()} label="Color" />,
    );

    expect(getByText('Color')).toBeTruthy();
  });
});
