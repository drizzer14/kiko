import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

import PaymentHoldingField from '.';

const options: HoldingSelectOption[] = [
  {
    id: 'h1',
    name: 'Everyday card',
    icon: 'creditcard.fill',
    color: '#3366CC',
    currency: 'UAH',
    accountName: 'Monobank',
  },
];

describe('PaymentHoldingField', () => {
  it('shows "None" when nothing is picked', async () => {
    const { getByText } = await render(
      <PaymentHoldingField
        label="Paid from"
        noneLabel="None"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
      />,
    );

    expect(getByText('None')).toBeTruthy();
  });

  it('shows the picked holding name', async () => {
    const { getByText } = await render(
      <PaymentHoldingField
        label="Paid from"
        noneLabel="None"
        options={options}
        selectedId="h1"
        onSelect={jest.fn()}
      />,
    );

    expect(getByText('Everyday card')).toBeTruthy();
  });

  it('reports the picked holding id at once', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await render(
      <PaymentHoldingField
        label="Paid from"
        noneLabel="None"
        options={options}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    await fireEvent.press(getByLabelText('Paid from'));
    await fireEvent.press(getByText('Everyday card'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });

  it('reports null when "None" is picked from an existing selection', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getAllByText } = await render(
      <PaymentHoldingField
        label="Paid from"
        noneLabel="None"
        options={options}
        selectedId="h1"
        onSelect={onSelect}
      />,
    );

    await fireEvent.press(getByLabelText('Paid from'));
    await fireEvent.press(getAllByText('None')[0]);

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
