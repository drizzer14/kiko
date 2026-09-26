import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';

import type { HoldingType } from '@kiko/holdings/holding-type';

import HoldingTypeField from '.';

const options: readonly HoldingType[] = ['card', 'term_deposit', 'bond'];

const labels: Record<HoldingType, string> = {
  card: 'Card',
  term_deposit: 'Deposit',
  bond: 'Bond',
  cash: 'Cash',
  crypto_asset: 'Crypto asset',
  jar: 'Jar',
  property_item: 'Property',
  metal: 'Precious metal',
  loan: 'Loan',
};

const icons: Record<HoldingType, string> = {
  card: 'creditcard',
  term_deposit: 'calendar',
  bond: 'receipt',
  cash: 'banknote',
  crypto_asset: 'bitcoinsign.circle',
  jar: 'archivebox',
  property_item: 'house',
  metal: 'cube',
  loan: 'minus.circle',
};

const setup = async (overrides: Partial<Parameters<typeof HoldingTypeField>[0]> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <HoldingTypeField
      options={options}
      selected="term_deposit"
      onSelect={onSelect}
      labels={labels}
      icons={icons}
      disabled={false}
      testID="holding-type-field"
      {...overrides}
    />,
  );

  return { onSelect, ...utils };
};

describe('HoldingTypeField', () => {
  it("shows the selected type's label in the trigger", async () => {
    const { getByTestId } = await setup();

    expect(getByTestId('holding-type-field')).toHaveTextContent('Deposit');
  });

  it('opens a select sheet listing every offered type on trigger press', async () => {
    const { getByTestId, queryByTestId } = await setup();

    expect(queryByTestId('holding-type-field-option-bond')).toBeNull();

    await fireEvent.press(getByTestId('holding-type-field'));

    for (const option of options) {
      expect(getByTestId(`holding-type-field-option-${option}`)).toBeTruthy();
    }
  });

  it('reports the picked type and closes the sheet', async () => {
    const { onSelect, getByTestId, queryByTestId } = await setup();

    await fireEvent.press(getByTestId('holding-type-field'));
    await fireEvent.press(getByTestId('holding-type-field-option-bond'));

    expect(onSelect).toHaveBeenCalledWith('bond');
    expect(queryByTestId('holding-type-field-option-bond')).toBeNull();
  });

  it('dims and does not switch while disabled (edit mode)', async () => {
    const { getByTestId, queryByTestId } = await setup({ disabled: true });

    await fireEvent.press(getByTestId('holding-type-field'));

    expect(queryByTestId('holding-type-field-option-bond')).toBeNull();
  });
});
