import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import PropertySection from './property-section.component';

const baseProps = {
  cost: '',
  onChangeCost: jest.fn(),
  currencySuffix: '₴',
};

describe('PropertySection', () => {
  it('shows the cost field, labeled Cost', async () => {
    const { getByLabelText } = await render(<PropertySection {...baseProps} />);

    expect(getByLabelText('Cost')).toBeTruthy();
  });

  it('reports the entered cost', async () => {
    const onChangeCost = jest.fn();
    const { getByLabelText } = await render(
      <PropertySection {...baseProps} onChangeCost={onChangeCost} />,
    );

    await fireEvent.changeText(getByLabelText('Cost'), '5000');

    expect(onChangeCost).toHaveBeenCalledWith('5000');
  });

  it('renders costError directly after the cost field', async () => {
    const { getByText } = await render(
      <PropertySection {...baseProps} costError="Enter a cost greater than 0." />,
    );

    expect(getByText('Enter a cost greater than 0.')).toBeTruthy();
  });
});
