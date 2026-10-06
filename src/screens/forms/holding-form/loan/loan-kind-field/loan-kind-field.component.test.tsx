import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import type { LoanKind } from '@kiko/holdings/holding-metadata';
import { glyphNamesWithin } from '@kiko/test-support/glyphs-within';

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

  it('reads Mortgage, Car loan, Consumer loan and From a person on the sheet rows', async () => {
    const { getByTestId } = await render(
      <LoanKindField selected="mortgage" onSelect={jest.fn()} testID="loan-kind" />,
    );

    await fireEvent.press(getByTestId('loan-kind'));

    expect(getByTestId('loan-kind-option-mortgage')).toHaveTextContent('Mortgage');
    expect(getByTestId('loan-kind-option-car_loan')).toHaveTextContent('Car loan');
    expect(getByTestId('loan-kind-option-consumer_loan')).toHaveTextContent('Consumer loan');
    expect(getByTestId('loan-kind-option-personal')).toHaveTextContent('From a person');
  });

  it('titles the sheet Type, beside the Type label of the field', async () => {
    const { getByTestId, getAllByText } = await render(
      <LoanKindField selected="mortgage" onSelect={jest.fn()} testID="loan-kind" />,
    );

    expect(getAllByText('Type')).toHaveLength(1);

    await fireEvent.press(getByTestId('loan-kind'));

    expect(getAllByText('Type')).toHaveLength(2);
  });

  it('shows the Select a type placeholder when the stored kind is none of the four', async () => {
    const { getByTestId } = await render(
      <LoanKindField selected={'unknown' as LoanKind} onSelect={jest.fn()} testID="loan-kind" />,
    );

    expect(getByTestId('loan-kind')).toHaveTextContent('Select a type');
  });

  it('stays pressable (the kind is editable on an existing loan)', async () => {
    const { getByTestId } = await render(
      <LoanKindField selected="mortgage" onSelect={jest.fn()} testID="loan-kind" />,
    );

    expect(getByTestId('loan-kind').props.accessibilityState?.disabled).not.toBe(true);
  });
});
