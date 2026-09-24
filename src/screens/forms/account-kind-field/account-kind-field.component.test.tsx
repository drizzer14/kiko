import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';

import '../../../design-system/unistyles';
import AccountKindField from '.';
import type { AccountKind } from './account-kind-field.props';

const options: readonly AccountKind[] = ['bank', 'cash', 'crypto', 'property', 'metals', 'debt'];

const labels: Record<AccountKind, string> = {
  bank: 'Bank',
  cash: 'Cash',
  crypto: 'Crypto',
  property: 'Property',
  metals: 'Precious metals',
  debt: 'Debt',
};

const subtitles: Record<AccountKind, string> = {
  bank: 'A bank account you sync or import statements for.',
  cash: 'Cash you hold outside a bank.',
  crypto: 'A wallet or exchange account.',
  property: 'Real estate, car, valuables, money you lent',
  metals: 'Gold, silver, platinum, palladium',
  debt: 'A loan or debt you owe.',
};

const icons: Record<AccountKind, string> = {
  bank: 'building.columns.fill',
  cash: 'banknote',
  crypto: 'bitcoinsign.circle',
  property: 'house.fill',
  metals: 'cube.fill',
  debt: 'minus.circle.fill',
};

const setup = async (overrides: Partial<Parameters<typeof AccountKindField>[0]> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <AccountKindField
      label="Kind"
      sheetTitle="Select an Account Kind"
      options={options}
      selected="bank"
      onSelect={onSelect}
      labels={labels}
      subtitles={subtitles}
      icons={icons}
      disabled={false}
      testID="account-kind-field"
      {...overrides}
    />,
  );

  return { onSelect, ...utils };
};

describe('AccountKindField', () => {
  it("shows the selected kind's label and glyph in the trigger", async () => {
    const { getByTestId, toJSON } = await setup();

    expect(getByTestId('account-kind-field')).toHaveTextContent('Bank');
    expect(JSON.stringify(toJSON())).toContain('building.columns.fill');
  });

  it('lists every offered kind, each with its label and subtitle, on trigger press', async () => {
    const { getByTestId, queryByTestId } = await setup();

    // Each option row is only mounted once the sheet opens.
    expect(queryByTestId('account-kind-field-option-cash')).toBeNull();

    await fireEvent.press(getByTestId('account-kind-field'));

    for (const kind of options) {
      const row = getByTestId(`account-kind-field-option-${kind}`);
      expect(row).toBeTruthy();
      expect(getByTestId(`account-kind-field-option-${kind}-description`)).toHaveTextContent(
        subtitles[kind],
      );
    }
  });

  it('reports the picked kind and closes the sheet', async () => {
    const { onSelect, getByTestId, queryByTestId } = await setup();

    await fireEvent.press(getByTestId('account-kind-field'));
    await fireEvent.press(getByTestId('account-kind-field-option-property'));

    expect(onSelect).toHaveBeenCalledWith('property');
    expect(queryByTestId('account-kind-field-option-property')).toBeNull();
  });

  it('shows a checkmark on the currently-selected kind option', async () => {
    const { getByTestId } = await setup({ selected: 'crypto' });

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(getByTestId('account-kind-field-option-crypto').props.accessibilityState.selected).toBe(
      true,
    );
    expect(getByTestId('account-kind-field-option-bank').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('dims and does not open while disabled (edit mode / a source already connected)', async () => {
    const { getByTestId, getByText, queryByTestId } = await setup({ disabled: true });

    const field = ancestorWithStyle(getByText('Bank'), 'opacity');
    expect(StyleSheet.flatten(field.props.style).opacity).toBeLessThan(1);

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(queryByTestId('account-kind-field-option-cash')).toBeNull();
  });
});
