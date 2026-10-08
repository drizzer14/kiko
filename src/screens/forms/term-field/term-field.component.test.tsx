import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { fieldSuffix } from '@kiko/test-support/field-suffix';

import TermField from './term-field.component';

const renderField = (overrides: Partial<Parameters<typeof TermField>[0]> = {}) =>
  render(
    <TermField
      value="3"
      onChangeValue={jest.fn()}
      unit="months"
      onSelectUnit={jest.fn()}
      {...overrides}
    />,
  );

describe('TermField', () => {
  it('shows the typed number under the Term label, in months by default', async () => {
    const { getByLabelText } = await renderField();

    expect(getByLabelText('Term').props.value).toBe('3');
    expect(fieldSuffix(getByLabelText('Term'))).toBe('mo');
  });

  it('shows years after the number once Years is the unit', async () => {
    const { getByLabelText } = await renderField({ unit: 'years' });

    expect(fieldSuffix(getByLabelText('Term'))).toBe('yr');
  });

  it('reports the typed number and the picked unit', async () => {
    const onChangeValue = jest.fn();
    const onSelectUnit = jest.fn();
    const { getByLabelText, getByText } = await renderField({ onChangeValue, onSelectUnit });

    await fireEvent.changeText(getByLabelText('Term'), '5');
    await fireEvent.press(getByText('Years'));

    expect(onChangeValue).toHaveBeenCalledWith('5');
    expect(onSelectUnit).toHaveBeenCalledWith('years');
  });

  it('shows the passed error', async () => {
    const { getByText } = await renderField({ error: 'Enter a whole number of years.' });

    expect(getByText('Enter a whole number of years.')).toBeTruthy();
  });
});
