import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';

import '../../../design-system/unistyles';
import ModeSelectField from '.';
import type { FormMode } from './mode-select-field.props';

const labels: Record<FormMode, string> = {
  income: 'Income',
  expense: 'Expense',
  exchange: 'Exchange',
  split: 'Split',
};

const icons: Record<FormMode, string> = {
  income: 'arrow.down',
  expense: 'arrow.up',
  exchange: 'arrow.left.arrow.right',
  split: 'arrow.trianglehead.branch',
};

const setup = async (overrides: Partial<Parameters<typeof ModeSelectField>[0]> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <ModeSelectField
      visible
      label="Type"
      options={['income', 'expense', 'exchange', 'split']}
      selected="expense"
      onSelect={onSelect}
      labels={labels}
      icons={icons}
      disabled={false}
      {...overrides}
    />,
  );

  return { onSelect, ...utils };
};

describe('ModeSelectField', () => {
  it('renders nothing while it is not visible', async () => {
    const { queryByTestId } = await setup({ visible: false });

    expect(queryByTestId('transaction-type-field')).toBeNull();
  });

  it("shows the selected mode's label and glyph in the trigger", async () => {
    const { getByTestId, toJSON } = await setup();

    // The trigger shows the selected mode's label…
    expect(getByTestId('transaction-type-field')).toHaveTextContent('Expense');
    // …and its glyph, rendered through the mocked SFSymbolView (asserted by the
    // symbol name in the tree, the same approach the screen test uses).
    expect(JSON.stringify(toJSON())).toContain('arrow.up');
  });

  it('opens the sheet listing every provided mode as a selectable row on trigger press', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await setup();

    // Each option row is only mounted once the sheet opens.
    expect(queryByTestId('transaction-type-option-income')).toBeNull();

    await fireEvent.press(getByLabelText('Type'));

    for (const mode of ['income', 'expense', 'exchange', 'split']) {
      expect(getByTestId(`transaction-type-option-${mode}`)).toBeTruthy();
    }
  });

  it('calls onSelect with the picked mode and closes the sheet', async () => {
    const { onSelect, getByLabelText, getByTestId, queryByTestId } = await setup();

    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByTestId('transaction-type-option-income'));

    expect(onSelect).toHaveBeenCalledWith('income');
    // The sheet closes on pick, so the option rows unmount.
    expect(queryByTestId('transaction-type-option-income')).toBeNull();
  });

  it('dims and does not open while disabled', async () => {
    const { getByLabelText, getByText, queryByTestId } = await setup({ disabled: true });

    // The disabled trigger dims via the shared FieldTrigger's `fieldDisabled`
    // style (a reduced opacity). The style sits on the field Box wrapping the
    // value label, so walk up from that label; pinned so the locked state
    // cannot be lost.
    const field = ancestorWithStyle(getByText('Expense'), 'opacity');

    expect(StyleSheet.flatten(field.props.style).opacity).toBeLessThan(1);

    // Pressing an inert trigger never opens the sheet, so no option row mounts.
    await fireEvent.press(getByLabelText('Type'));

    expect(queryByTestId('transaction-type-option-income')).toBeNull();
  });
});
