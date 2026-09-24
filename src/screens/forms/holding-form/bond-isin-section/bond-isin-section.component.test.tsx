import { fireEvent, render } from '@testing-library/react-native';

import '../../../../design-system/unistyles';
import '../../../../i18n';

import type { BondTerms } from '../../../../bonds/nbu-register';

import BondIsinSection from './bond-isin-section.component';

const foundTerms: BondTerms = {
  isin: 'UA4000234215',
  currency: 'USD',
  faceValueMinorUnits: 100_000,
  couponPct: 9.5,
  maturityDate: new Date(2028, 0, 1).getTime(),
  couponFrequency: 'quarterly',
  name: 'Register Bond UA4000234215',
};

const baseProps = {
  mode: 'isin' as const,
  onSelectMode: jest.fn(),
  isin: '',
  onChangeIsin: jest.fn(),
  foundTerms: null,
  onSwitchToManual: jest.fn(),
};

describe('BondIsinSection', () => {
  it('renders the ISIN/Manual segmented control, defaulted to ISIN', async () => {
    const { getByText, getByTestId } = await render(<BondIsinSection {...baseProps} />);

    expect(getByText('Manual')).toBeTruthy();
    expect(
      getByTestId('bond-isin-mode-control-option-isin').props.accessibilityState.selected,
    ).toBe(true);
    expect(
      getByTestId('bond-isin-mode-control-option-manual').props.accessibilityState.selected,
    ).toBe(false);
  });

  it('reports the tapped mode', async () => {
    const onSelectMode = jest.fn();
    const { getByText } = await render(
      <BondIsinSection {...baseProps} onSelectMode={onSelectMode} />,
    );

    await fireEvent.press(getByText('Manual'));

    expect(onSelectMode).toHaveBeenCalledWith('manual');
  });

  it('renders an ISIN field that auto-uppercases what is typed', async () => {
    const onChangeIsin = jest.fn();
    const { getByPlaceholderText } = await render(
      <BondIsinSection {...baseProps} onChangeIsin={onChangeIsin} />,
    );

    await fireEvent.changeText(getByPlaceholderText('UA4000234215'), 'ua4000234215');

    expect(onChangeIsin).toHaveBeenCalledWith('UA4000234215');
  });

  it('shows the passed-through ISIN error message', async () => {
    const { getByText } = await render(
      <BondIsinSection {...baseProps} isinError="ISIN check digit is wrong." />,
    );

    expect(getByText('ISIN check digit is wrong.')).toBeTruthy();
  });

  it('renders a read-only summary (coupon, maturity, currency) once a bond is found', async () => {
    const { getByText } = await render(
      <BondIsinSection {...baseProps} isin="UA4000234215" foundTerms={foundTerms} />,
    );

    expect(getByText(/9\.5/)).toBeTruthy();
    expect(getByText(/01\.01\.2028/)).toBeTruthy();
    expect(getByText(/USD/)).toBeTruthy();
  });

  it('shows a "not in the NBU register" hint with a Switch to manual button once a validly-shaped ISIN is not found', async () => {
    const { getByText } = await render(
      <BondIsinSection {...baseProps} isin="UA4000234215" foundTerms={null} />,
    );

    expect(getByText('Not in the NBU register.')).toBeTruthy();
    expect(getByText('Switch to manual')).toBeTruthy();
  });

  it('reports switching to Manual, keeping the typed ISIN in place', async () => {
    const onSwitchToManual = jest.fn();
    const { getByText } = await render(
      <BondIsinSection
        {...baseProps}
        isin="UA4000234215"
        foundTerms={null}
        onSwitchToManual={onSwitchToManual}
      />,
    );

    await fireEvent.press(getByText('Switch to manual'));

    expect(onSwitchToManual).toHaveBeenCalled();
  });

  it('shows neither the found summary nor the not-found hint while the ISIN is still incomplete', async () => {
    const { queryByText } = await render(<BondIsinSection {...baseProps} isin="UA400" />);

    expect(queryByText('Not in the NBU register.')).toBeNull();
  });

  it('hides the found summary and not-found hint in Manual mode', async () => {
    const { queryByText } = await render(
      <BondIsinSection {...baseProps} mode="manual" isin="UA4000234215" foundTerms={null} />,
    );

    expect(queryByText('Not in the NBU register.')).toBeNull();
  });

  it('renders the Diia hint in ISIN mode', async () => {
    const { getByText } = await render(<BondIsinSection {...baseProps} mode="isin" />);

    expect(
      getByText('Bought in Diia? Add the bond under the bank or broker you chose there.'),
    ).toBeTruthy();
  });

  it('renders the Diia hint in Manual mode too', async () => {
    const { getByText } = await render(<BondIsinSection {...baseProps} mode="manual" />);

    expect(
      getByText('Bought in Diia? Add the bond under the bank or broker you chose there.'),
    ).toBeTruthy();
  });
});
