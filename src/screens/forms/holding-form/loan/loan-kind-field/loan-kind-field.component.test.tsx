import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { glyphNamesWithin } from '@kiko/test-support/glyph-names-within';

import LoanKindField from './loan-kind-field.component';

describe('LoanKindField', () => {
  it("shows the selected kind's label in the trigger, labeled Type", async () => {
    const { getByText, getByTestId } = await render(
      <LoanKindField selected="car_loan" onSelect={jest.fn()} testID="loan-kind" />,
    );

    expect(getByText('Type')).toBeTruthy();
    expect(getByTestId('loan-kind')).toHaveTextContent('Car loan');
  });

  it('lists the four loan kinds in the Mortgage/Car loan/Consumer loan/From a person order, and reports the tapped one', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getAllByTestId } = await render(
      <LoanKindField selected="mortgage" onSelect={onSelect} testID="loan-kind" />,
    );

    await fireEvent.press(getByTestId('loan-kind'));

    expect(getAllByTestId(/^loan-kind-option-/).map((row) => row.props.testID)).toEqual([
      'loan-kind-option-mortgage',
      'loan-kind-option-car_loan',
      'loan-kind-option-consumer_loan',
      'loan-kind-option-personal',
    ]);

    await fireEvent.press(getByTestId('loan-kind-option-personal'));

    expect(onSelect).toHaveBeenCalledWith('personal');
  });

  it("shows each kind's own glyph on its sheet row and the selected one on the trigger", async () => {
    const { getByTestId } = await render(
      <LoanKindField selected="consumer_loan" onSelect={jest.fn()} testID="loan-kind" />,
    );

    expect(glyphNamesWithin(getByTestId('loan-kind'))).toEqual(['cart.fill']);

    await fireEvent.press(getByTestId('loan-kind'));

    expect(glyphNamesWithin(getByTestId('loan-kind-option-mortgage'))).toContain(
      'house.circle.fill',
    );
    expect(glyphNamesWithin(getByTestId('loan-kind-option-car_loan'))).toContain('car.fill');
    expect(glyphNamesWithin(getByTestId('loan-kind-option-personal'))).toContain('person.fill');
  });

  it('stays pressable (the kind is editable on an existing loan)', async () => {
    const { getByTestId } = await render(
      <LoanKindField selected="mortgage" onSelect={jest.fn()} testID="loan-kind" />,
    );

    expect(getByTestId('loan-kind').props.accessibilityState?.disabled).not.toBe(true);
  });
});
