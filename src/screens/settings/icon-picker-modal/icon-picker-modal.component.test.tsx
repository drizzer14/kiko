import { fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
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
});
