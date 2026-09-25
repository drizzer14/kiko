import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n';

import PropertySection from './property-section.component';

const baseProps = {
  category: 'real_estate' as const,
  onSelectCategory: jest.fn(),
  showCost: true,
  cost: '',
  onChangeCost: jest.fn(),
  currencySuffix: '₴',
};

describe('PropertySection', () => {
  it('shows the selected category in the field trigger, labeled Category', async () => {
    const { getByTestId, getByText } = await render(<PropertySection {...baseProps} />);

    expect(getByText('Category')).toBeTruthy();
    expect(getByTestId('property-category-field')).toHaveTextContent('Real estate');
  });

  it('lists every property category in the sheet and reports the tapped one', async () => {
    const onSelectCategory = jest.fn();
    const { getByTestId } = await render(
      <PropertySection {...baseProps} onSelectCategory={onSelectCategory} />,
    );

    await fireEvent.press(getByTestId('property-category-field'));

    expect(getByTestId('property-category-field-option-real_estate')).toBeTruthy();
    expect(getByTestId('property-category-field-option-vehicle')).toBeTruthy();
    expect(getByTestId('property-category-field-option-valuable')).toBeTruthy();
    expect(getByTestId('property-category-field-option-loan_given')).toBeTruthy();
    expect(getByTestId('property-category-field-option-business_share')).toBeTruthy();
    expect(getByTestId('property-category-field-option-other')).toBeTruthy();

    await fireEvent.press(getByTestId('property-category-field-option-vehicle'));

    expect(onSelectCategory).toHaveBeenCalledWith('vehicle');
  });

  it('shows the cost field when showCost is true', async () => {
    const { getByLabelText } = await render(<PropertySection {...baseProps} />);

    expect(getByLabelText('Cost')).toBeTruthy();
  });

  it('hides the cost field when showCost is false', async () => {
    const { queryByLabelText } = await render(<PropertySection {...baseProps} showCost={false} />);

    expect(queryByLabelText('Cost')).toBeNull();
  });

  it('reports the entered cost', async () => {
    const onChangeCost = jest.fn();
    const { getByLabelText } = await render(
      <PropertySection {...baseProps} onChangeCost={onChangeCost} />,
    );

    fireEvent.changeText(getByLabelText('Cost'), '5000');

    expect(onChangeCost).toHaveBeenCalledWith('5000');
  });

  it('renders costError directly after the cost field', async () => {
    const { getByText } = await render(
      <PropertySection {...baseProps} costError="Enter a cost greater than 0." />,
    );

    expect(getByText('Enter a cost greater than 0.')).toBeTruthy();
  });
});
