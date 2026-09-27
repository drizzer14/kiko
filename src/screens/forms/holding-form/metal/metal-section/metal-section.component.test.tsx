import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { fieldSuffix } from '@kiko/test-support/field-suffix';

import MetalSection from './metal-section.component';

const baseProps = {
  form: 'bar' as const,
  onSelectForm: jest.fn(),
  unit: 'oz' as const,
  onSelectUnit: jest.fn(),
  purity: '999.9',
  onChangePurity: jest.fn(),
  showFirstLot: true,
  quantity: '',
  onChangeQuantity: jest.fn(),
  cost: '',
  onChangeCost: jest.fn(),
  currencySuffix: '₴',
};

describe('MetalSection', () => {
  it('leaves the metal itself to the Type slot', async () => {
    const { queryByText } = await render(<MetalSection {...baseProps} />);

    expect(queryByText('Gold')).toBeNull();
  });

  it('renders every form as a chip, under a Form label', async () => {
    const { getByText } = await render(<MetalSection {...baseProps} />);

    expect(getByText('Form')).toBeTruthy();
    expect(getByText('Bar')).toBeTruthy();
    expect(getByText('Coin')).toBeTruthy();
    expect(getByText('Metal account')).toBeTruthy();
  });

  it('reports the tapped form', async () => {
    const onSelectForm = jest.fn();
    const { getByText } = await render(<MetalSection {...baseProps} onSelectForm={onSelectForm} />);

    await fireEvent.press(getByText('Coin'));

    expect(onSelectForm).toHaveBeenCalledWith('coin');
  });

  it('renders every unit as a chip, under a Unit label', async () => {
    const { getByText } = await render(<MetalSection {...baseProps} />);

    expect(getByText('Unit')).toBeTruthy();
    expect(getByText('Grams')).toBeTruthy();
    expect(getByText('Troy ounces')).toBeTruthy();
  });

  it('reports the tapped unit', async () => {
    const onSelectUnit = jest.fn();
    const { getByText } = await render(<MetalSection {...baseProps} onSelectUnit={onSelectUnit} />);

    await fireEvent.press(getByText('Grams'));

    expect(onSelectUnit).toHaveBeenCalledWith('g');
  });

  it('shows the purity as a fineness per mille', async () => {
    const { getByLabelText } = await render(<MetalSection {...baseProps} />);

    expect(getByLabelText('Purity').props.value).toBe('999.9');
    expect(fieldSuffix(getByLabelText('Purity'))).toBe('‰');
  });

  it('reports the entered purity', async () => {
    const onChangePurity = jest.fn();
    const { getByLabelText } = await render(
      <MetalSection {...baseProps} onChangePurity={onChangePurity} />,
    );

    await fireEvent.changeText(getByLabelText('Purity'), '585');

    expect(onChangePurity).toHaveBeenCalledWith('585');
  });

  it('shows the first-lot Quantity and Total cost fields when showFirstLot is true', async () => {
    const { getByLabelText } = await render(<MetalSection {...baseProps} />);

    expect(getByLabelText('Quantity')).toBeTruthy();
    expect(getByLabelText('Total cost')).toBeTruthy();
  });

  it('shows the picked unit after the quantity', async () => {
    const { getByLabelText, rerender } = await render(<MetalSection {...baseProps} unit="g" />);

    expect(fieldSuffix(getByLabelText('Quantity'))).toBe('g');

    await rerender(<MetalSection {...baseProps} unit="oz" />);

    expect(fieldSuffix(getByLabelText('Quantity'))).toBe('oz');
  });

  it('hides the first-lot fields when showFirstLot is false', async () => {
    const { queryByLabelText } = await render(<MetalSection {...baseProps} showFirstLot={false} />);

    expect(queryByLabelText('Quantity')).toBeNull();
    expect(queryByLabelText('Total cost')).toBeNull();
  });

  it('reports the entered quantity and cost', async () => {
    const onChangeQuantity = jest.fn();
    const onChangeCost = jest.fn();
    const { getByLabelText } = await render(
      <MetalSection
        {...baseProps}
        onChangeQuantity={onChangeQuantity}
        onChangeCost={onChangeCost}
      />,
    );

    await fireEvent.changeText(getByLabelText('Quantity'), '31.1');
    await fireEvent.changeText(getByLabelText('Total cost'), '80000');

    expect(onChangeQuantity).toHaveBeenCalledWith('31.1');
    expect(onChangeCost).toHaveBeenCalledWith('80000');
  });

  it('renders quantityError and costError directly after their fields', async () => {
    const { getByText } = await render(
      <MetalSection
        {...baseProps}
        quantityError="Enter a quantity greater than 0."
        costError="Total cost must be greater than 0."
      />,
    );

    expect(getByText('Enter a quantity greater than 0.')).toBeTruthy();
    expect(getByText('Total cost must be greater than 0.')).toBeTruthy();
  });

  // Purity is validated on Save (0 < purity <= 1) — a required
  // field with its own placeholder and inline error, like every other
  // validated field.
  it('renders purityError directly after the field', async () => {
    const { getByText } = await render(
      <MetalSection {...baseProps} purityError="Enter a fineness above 0 and up to 1000 ‰." />,
    );

    expect(getByText('Enter a fineness above 0 and up to 1000 ‰.')).toBeTruthy();
  });

  it('marks the purity field as required, with an example-value placeholder', async () => {
    const { getAllByText, getByPlaceholderText } = await render(
      <MetalSection {...baseProps} purity="" showFirstLot={false} />,
    );

    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(1);
    expect(getByPlaceholderText('999.9')).toBeTruthy();
  });
});
