import { fireEvent, render } from '@testing-library/react-native';

import '../../../../design-system/unistyles';
import '../../../../i18n';

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
  it('renders every property category as a chip, under a Category label', async () => {
    const { getByText } = await render(<PropertySection {...baseProps} />);

    expect(getByText('Category')).toBeTruthy();
    expect(getByText('Real estate')).toBeTruthy();
    expect(getByText('Vehicle')).toBeTruthy();
    expect(getByText('Valuable')).toBeTruthy();
    expect(getByText('Loan given')).toBeTruthy();
    expect(getByText('Business share')).toBeTruthy();
    expect(getByText('Other')).toBeTruthy();
  });

  it('reports the tapped category', async () => {
    const onSelectCategory = jest.fn();
    const { getByText } = await render(
      <PropertySection {...baseProps} onSelectCategory={onSelectCategory} />,
    );

    await fireEvent.press(getByText('Vehicle'));

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
