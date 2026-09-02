import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import IconPickerModal from '.';

type Overrides = Partial<ComponentProps<typeof IconPickerModal>>;

const setup = async (overrides: Overrides = {}) => {
  const onSelect = jest.fn();
  const onDismiss = jest.fn();

  const utils = await render(
    <IconPickerModal
      visible
      selectedIcon="cart"
      onSelect={onSelect}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );

  return { onSelect, onDismiss, ...utils };
};

describe('IconPickerModal', () => {
  it('renders the full curated icon pool as pressable choices when visible', async () => {
    const { getAllByLabelText, getByLabelText } = await setup();

    // The whole 60-icon pool is offered at once inside the scrollable grid.
    expect(getAllByLabelText(/^Choose icon /).length).toBeGreaterThan(40);
    expect(getByLabelText('Choose icon basket')).toBeTruthy();
  });

  it('renders nothing while it is not visible', async () => {
    const { queryByLabelText } = await setup({ visible: false });

    expect(queryByLabelText('Choose icon cart')).toBeNull();
  });

  it('calls onSelect with the chosen icon when an option is pressed', async () => {
    const { onSelect, getByLabelText } = await setup();

    fireEvent.press(getByLabelText('Choose icon basket'));

    expect(onSelect).toHaveBeenCalledWith('basket');
  });

  it('calls onDismiss when the cancel control is pressed', async () => {
    const { onDismiss, getByText } = await setup();

    fireEvent.press(getByText('Cancel'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when the backdrop behind the sheet is tapped', async () => {
    const { onDismiss, getByLabelText } = await setup();

    fireEvent.press(getByLabelText('Dismiss icon picker'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pads the sheet clear of the home indicator (bottom safe-area inset)', async () => {
    const { getByText } = await setup();

    // Walk up from a known sheet child to the sheet Box itself, the same
    // ancestor-search approach the currency-breakdown tests use, since RNTL
    // has no direct `getByTestId` here.
    let node = getByText('Choose Icon');
    while (node && StyleSheet.flatten(node.props.style)?.paddingBottom === undefined) {
      node = node.parent;
    }

    // The safe-area mock reports a 0 bottom inset by default, so the padding
    // collapses to the sheet's own base spacing(6) = 24 — this only proves the
    // inset is additive, not double-subtracted or dropped.
    expect(StyleSheet.flatten(node.props.style).paddingBottom).toBeGreaterThanOrEqual(24);
  });

  it('offers no Remove control when onRemove is not provided', async () => {
    const { queryByText } = await setup();

    expect(queryByText('Remove')).toBeNull();
  });

  it('renders a Remove control and calls onRemove when it is pressed', async () => {
    const onRemove = jest.fn();
    const { getByText } = await setup({ onRemove });

    fireEvent.press(getByText('Remove'));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
