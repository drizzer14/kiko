import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n';

import PropertyTypeField from './property-type-field.component';

describe('PropertyTypeField', () => {
  it("shows the selected category's label in the trigger, labeled Type", async () => {
    const { getByText, getByTestId } = await render(
      <PropertyTypeField selected="real_estate" onSelect={jest.fn()} testID="property-type" />,
    );

    expect(getByText('Type')).toBeTruthy();
    expect(getByTestId('property-type')).toHaveTextContent('Real estate');
  });

  it('lists every property category, in the Real estate/Vehicle/Valuable/Business share/Loan given/Other order, and reports the tapped one', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getAllByTestId } = await render(
      <PropertyTypeField selected="real_estate" onSelect={onSelect} testID="property-type" />,
    );

    await fireEvent.press(getByTestId('property-type'));

    const rows = getAllByTestId(/^property-type-option-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'property-type-option-real_estate',
      'property-type-option-vehicle',
      'property-type-option-valuable',
      'property-type-option-business_share',
      'property-type-option-loan_given',
      'property-type-option-other',
    ]);

    await fireEvent.press(getByTestId('property-type-option-vehicle'));

    expect(onSelect).toHaveBeenCalledWith('vehicle');
  });
});
