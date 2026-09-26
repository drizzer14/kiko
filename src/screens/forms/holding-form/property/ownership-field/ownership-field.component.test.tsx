import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n';

import { fieldSuffix } from '../../../../../test-support/field-suffix';

import OwnershipField from './ownership-field.component';

const renderField = (overrides: Partial<Parameters<typeof OwnershipField>[0]> = {}) =>
  render(
    <OwnershipField
      mode="percent"
      onSelectMode={jest.fn()}
      percent="50"
      onChangePercent={jest.fn()}
      numerator="1"
      onChangeNumerator={jest.fn()}
      denominator="3"
      onChangeDenominator={jest.fn()}
      showsEffectiveDate={false}
      effectiveDate={new Date(2026, 0, 1).getTime()}
      onChangeEffectiveDate={jest.fn()}
      {...overrides}
    />,
  );

describe('OwnershipField', () => {
  it('shows one percent field with a % suffix in percent mode', async () => {
    const { getByLabelText, queryByLabelText, getByText } = await renderField();

    expect(getByText('Ownership')).toBeTruthy();
    expect(getByLabelText('Share').props.value).toBe('50');
    expect(fieldSuffix(getByLabelText('Share'))).toBe('%');
    expect(queryByLabelText('Out of')).toBeNull();
  });

  it('shows the share and out-of fields in fraction mode', async () => {
    const { getByLabelText } = await renderField({ mode: 'fraction' });

    expect(getByLabelText('Share').props.value).toBe('1');
    expect(fieldSuffix(getByLabelText('Share'))).toBeNull();
    expect(getByLabelText('Out of').props.value).toBe('3');
  });

  it('reports the picked mode and the typed values', async () => {
    const onSelectMode = jest.fn();
    const onChangeNumerator = jest.fn();
    const onChangeDenominator = jest.fn();
    const { getByLabelText, getByText } = await renderField({
      mode: 'fraction',
      onSelectMode,
      onChangeNumerator,
      onChangeDenominator,
    });

    await fireEvent.press(getByText('Percent'));
    await fireEvent.changeText(getByLabelText('Share'), '2');
    await fireEvent.changeText(getByLabelText('Out of'), '5');

    expect(onSelectMode).toHaveBeenCalledWith('percent');
    expect(onChangeNumerator).toHaveBeenCalledWith('2');
    expect(onChangeDenominator).toHaveBeenCalledWith('5');
  });

  it('reports the typed percent', async () => {
    const onChangePercent = jest.fn();
    const { getByLabelText } = await renderField({ onChangePercent });

    await fireEvent.changeText(getByLabelText('Share'), '25');

    expect(onChangePercent).toHaveBeenCalledWith('25');
  });

  it('shows the effective date only when asked', async () => {
    const hidden = await renderField();

    expect(hidden.queryByLabelText('Effective from')).toBeNull();

    const shown = await renderField({ showsEffectiveDate: true });

    expect(shown.getByLabelText('Effective from')).toBeTruthy();
  });

  it('shows the passed error', async () => {
    const { getByText } = await renderField({
      error: 'Enter a share above 0 and up to 100%.',
    });

    expect(getByText('Enter a share above 0 and up to 100%.')).toBeTruthy();
  });
});
