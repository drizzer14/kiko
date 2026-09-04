import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import HoldingIdentityField from '.';

type Overrides = Partial<ComponentProps<typeof HoldingIdentityField>>;

const setup = async (overrides: Overrides = {}) => {
  const onChangeName = jest.fn();
  const onSelectIcon = jest.fn();
  const onRemoveIcon = jest.fn();

  const utils = await render(
    <HoldingIdentityField
      icon={null}
      fallbackIcon="creditcard"
      name="My card"
      onChangeName={onChangeName}
      onSelectIcon={onSelectIcon}
      onRemoveIcon={onRemoveIcon}
      {...overrides}
    />,
  );

  return { onChangeName, onSelectIcon, onRemoveIcon, ...utils };
};

describe('HoldingIdentityField', () => {
  it('renders a Name caption and an editable name field defaulting its a11y label to Name', async () => {
    const { getByText, getByLabelText } = await setup();

    expect(getByText('Name')).toBeTruthy();
    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('reports name edits through onChangeName', async () => {
    const { onChangeName, getByLabelText } = await setup();

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed');

    expect(onChangeName).toHaveBeenCalledWith('Renamed');
  });

  it('shows the type-derived fallback glyph when no custom icon is set', async () => {
    const { getByLabelText } = await setup({ fallbackIcon: 'doc.text' });

    expect(getByLabelText('Icon doc.text')).toBeTruthy();
  });

  it('shows the custom icon over the fallback when one is set', async () => {
    const { getByLabelText } = await setup({ icon: 'banknote', fallbackIcon: 'doc.text' });

    expect(getByLabelText('Icon banknote')).toBeTruthy();
  });

  it('opens the icon picker and persists a pick through onSelectIcon', async () => {
    const { onSelectIcon, getByLabelText } = await setup();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(onSelectIcon).toHaveBeenCalledWith('basket');
  });

  it('commits on end-of-editing through the optional onEndEditingName handler', async () => {
    const onEndEditingName = jest.fn();
    const { getByLabelText } = await setup({
      onEndEditingName,
      nameAccessibilityLabel: 'Card name',
    });

    await fireEvent(getByLabelText('Card name'), 'endEditing');

    expect(onEndEditingName).toHaveBeenCalledTimes(1);
  });

  it('pins the icon control and the name field to the same fixed box height', async () => {
    const { getByLabelText } = await setup();

    // Both controls carry a fixed, explicit `height` (not a `minHeight` floor):
    // the name field's height must not be measurement-dependent, or a re-render
    // (typing, a type/color change) can collapse it toward its single-line
    // intrinsic content height. A definite equal height keeps it stable.
    const chipHeight = StyleSheet.flatten(getByLabelText('Change Icon').props.style).height;
    const fieldHeight = StyleSheet.flatten(getByLabelText('Name').props.style).height;

    expect(chipHeight).toBeGreaterThan(0);
    expect(fieldHeight).toBe(chipHeight);
  });

  it('renders a bare, caption-free pair (no Icon/Name labels) when captioned is false', async () => {
    const { getByLabelText, queryByText } = await setup({ captioned: false });

    // The name field is still reachable by its a11y label, but neither field
    // caption renders in the dense (category-row) layout.
    expect(getByLabelText('Name')).toBeTruthy();
    expect(queryByText('Icon')).toBeNull();
    expect(queryByText('Name')).toBeNull();
  });

  it('forwards an explicit iconAccessibilityLabel to the icon-picker toggle', async () => {
    const { getByLabelText } = await setup({
      captioned: false,
      iconAccessibilityLabel: 'Change Groceries icon',
    });

    expect(getByLabelText('Change Groceries icon')).toBeTruthy();
  });

  it('leaves the name field un-focused by default', async () => {
    const { getByLabelText } = await setup();

    // No caller opted into autoFocus, so the field must not grab focus on mount.
    expect(getByLabelText('Name').props.autoFocus).toBe(false);
  });

  it('forwards autoFocus to the name input so an on-demand field focuses on mount', async () => {
    const { getByLabelText } = await setup({ autoFocus: true });

    expect(getByLabelText('Name').props.autoFocus).toBe(true);
  });

  it('suppresses the icon Remove control when no onRemoveIcon handler is given', async () => {
    const { getByLabelText, queryByText } = await setup({
      icon: 'banknote',
      onRemoveIcon: undefined,
    });

    await fireEvent.press(getByLabelText('Change Icon'));

    expect(queryByText('Remove')).toBeNull();
  });
});
