import { fireEvent, render } from '@testing-library/react-native';

import '../../../../../design-system/unistyles';
import '../../../../../i18n';

import ManualBondFields from './manual-bond-fields.component';

const baseProps = {
  bondMode: 'manual' as const,
  faceValue: '',
  onChangeFaceValue: jest.fn(),
  faceValueFieldRef: undefined,
  faceValueInputRef: undefined,
  couponPct: '',
  onChangeCouponPct: jest.fn(),
  couponPctFieldRef: undefined,
  couponPctInputRef: undefined,
  maturityDate: null,
  onChangeMaturityDate: jest.fn(),
  maturityDateFieldRef: undefined,
  bondKind: 'government' as const,
  onSelectBondKind: jest.fn(),
  couponFrequency: 'semiannually' as const,
  onSelectCouponFrequency: jest.fn(),
  currencySuffix: '₴',
};

describe('ManualBondFields', () => {
  it('renders face value, coupon %, maturity date, bond kind, and coupon frequency in Manual mode', async () => {
    const { getByLabelText, getByText } = await render(<ManualBondFields {...baseProps} />);

    expect(getByLabelText('Face value')).toBeTruthy();
    expect(getByLabelText('Coupon %')).toBeTruthy();
    expect(getByText('Maturity date')).toBeTruthy();
    expect(getByText('Bond kind')).toBeTruthy();
    expect(getByText('Coupon frequency')).toBeTruthy();
  });

  it('renders nothing in ISIN mode', async () => {
    const { queryByLabelText } = await render(<ManualBondFields {...baseProps} bondMode="isin" />);

    expect(queryByLabelText('Face value')).toBeNull();
  });

  it('reports the entered face value and coupon %', async () => {
    const onChangeFaceValue = jest.fn();
    const onChangeCouponPct = jest.fn();
    const { getByLabelText } = await render(
      <ManualBondFields
        {...baseProps}
        onChangeFaceValue={onChangeFaceValue}
        onChangeCouponPct={onChangeCouponPct}
      />,
    );

    await fireEvent.changeText(getByLabelText('Face value'), '1000');
    await fireEvent.changeText(getByLabelText('Coupon %'), '9');

    expect(onChangeFaceValue).toHaveBeenCalledWith('1000');
    expect(onChangeCouponPct).toHaveBeenCalledWith('9');
  });

  it('reports the tapped bond kind and coupon frequency', async () => {
    const onSelectBondKind = jest.fn();
    const onSelectCouponFrequency = jest.fn();
    const { getByText, getByTestId } = await render(
      <ManualBondFields
        {...baseProps}
        onSelectBondKind={onSelectBondKind}
        onSelectCouponFrequency={onSelectCouponFrequency}
      />,
    );

    await fireEvent.press(getByText('Corporate'));
    // Coupon frequency is a select sheet (SelectField), not an inline chip —
    // the same control the ISIN mode's unmapped-frequency picker uses.
    await fireEvent.press(getByTestId('manual-bond-coupon-frequency-field'));
    await fireEvent.press(getByTestId('manual-bond-coupon-frequency-field-option-quarterly'));

    expect(onSelectBondKind).toHaveBeenCalledWith('corporate');
    expect(onSelectCouponFrequency).toHaveBeenCalledWith('quarterly');
  });

  it('shows the passed-through error messages', async () => {
    const { getByText } = await render(
      <ManualBondFields
        {...baseProps}
        faceValueError="Enter a face value greater than 0."
        couponPctError="Enter a coupon of 0 or higher."
        maturityDateError="Maturity date must be after the purchase date."
      />,
    );

    expect(getByText('Enter a face value greater than 0.')).toBeTruthy();
    expect(getByText('Enter a coupon of 0 or higher.')).toBeTruthy();
    expect(getByText('Maturity date must be after the purchase date.')).toBeTruthy();
  });
});
