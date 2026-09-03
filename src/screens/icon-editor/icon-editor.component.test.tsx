import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import '../../design-system/unistyles';
import IconEditor from '.';

type Overrides = Partial<ComponentProps<typeof IconEditor>>;

const setup = async (overrides: Overrides = {}) => {
  const onSelect = jest.fn();
  const onRemove = jest.fn();

  const utils = await render(
    <IconEditor
      icon={null}
      fallbackIcon="building.columns"
      label="Icon"
      onSelect={onSelect}
      onRemove={onRemove}
      {...overrides}
    />,
  );

  return { onSelect, onRemove, ...utils };
};

describe('IconEditor', () => {
  it('renders the label as a caption above the chip', async () => {
    const { getByText } = await setup();

    expect(getByText('Icon')).toBeTruthy();
  });

  it('renders the fallback glyph as a tappable chip labelled from the caption', async () => {
    const { getByLabelText } = await setup();

    expect(getByLabelText('Change Icon')).toBeTruthy();
  });

  it('renders a bare chip with a generic affordance and no caption when no label is given', async () => {
    const { getByLabelText, queryByText } = await setup({ label: undefined });

    expect(getByLabelText('Change icon')).toBeTruthy();
    expect(queryByText('Icon')).toBeNull();
  });

  it('opens the picker and persists the chosen icon through onSelect', async () => {
    const { onSelect, getByLabelText } = await setup();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(onSelect).toHaveBeenCalledWith('basket');
  });

  it('offers no Remove control while the row has no custom icon', async () => {
    const { getByLabelText, queryByText } = await setup();

    await fireEvent.press(getByLabelText('Change Icon'));

    expect(queryByText('Remove')).toBeNull();
  });

  it('offers a Remove control that clears a set icon through onRemove', async () => {
    const { onRemove, getByLabelText, getByText } = await setup({ icon: 'creditcard' });

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByText('Remove'));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('suppresses the Remove control entirely when no onRemove handler is supplied', async () => {
    // A mandatory-icon caller (a category row) omits onRemove; even a set icon
    // then offers no Remove, so the icon can never be cleared to none.
    const { getByLabelText, queryByText } = await setup({
      icon: 'creditcard',
      onRemove: undefined,
    });

    await fireEvent.press(getByLabelText('Change Icon'));

    expect(queryByText('Remove')).toBeNull();
  });

  it('renders the icon chip as a fixed square (explicit width equals height, no sibling-coupled aspectRatio)', async () => {
    const { getByLabelText } = await setup();

    const chip = StyleSheet.flatten(getByLabelText('Change Icon').props.style);

    // A fixed width === height square, not `aspectRatio` against a measured
    // cross-size: the chip's size must not be recomputed from a sibling's height
    // on re-render (that coupling collapsed the name field beside it), so it
    // carries explicit, equal, definite dimensions and no `aspectRatio`.
    expect(chip.width).toBeGreaterThan(0);
    expect(chip.height).toBe(chip.width);
    expect(chip.aspectRatio).toBeUndefined();
  });

  it('uses an explicit iconAccessibilityLabel for the toggle over the caption default', async () => {
    const { getByLabelText, queryByLabelText } = await setup({
      label: undefined,
      iconAccessibilityLabel: 'Change Groceries icon',
    });

    expect(getByLabelText('Change Groceries icon')).toBeTruthy();
    expect(queryByLabelText('Change icon')).toBeNull();
  });
});
