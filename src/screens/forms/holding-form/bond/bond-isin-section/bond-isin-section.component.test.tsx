import { fireEvent, render } from '@testing-library/react-native';

import '../../../../../design-system/unistyles';
import '../../../../../i18n';

import type { BondTerms } from '../../../../../bonds/nbu-register';

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
  // Non-null cache by default (a real "not found") — the M6 tests below
  // override this to exercise the "never loaded" wording.
  registerLoaded: true,
  onSwitchToManual: jest.fn(),
  needsCouponFrequencyPick: false,
  pickedCouponFrequency: null,
  onPickCouponFrequency: jest.fn(),
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

  it("forwards the typed ISIN text as-is (normalizing is the caller/hook's job)", async () => {
    const onChangeIsin = jest.fn();
    const { getByPlaceholderText } = await render(
      <BondIsinSection {...baseProps} onChangeIsin={onChangeIsin} />,
    );

    await fireEvent.changeText(getByPlaceholderText('UA4000234215'), 'ua4000234215');

    expect(onChangeIsin).toHaveBeenCalledWith('ua4000234215');
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

  it('shows a "not in the NBU register" hint with a Switch to manual button once a validly-shaped ISIN is not found and the cache has data', async () => {
    const { getByText } = await render(
      <BondIsinSection {...baseProps} isin="UA4000234215" foundTerms={null} registerLoaded />,
    );

    expect(getByText('Not in the NBU register.')).toBeTruthy();
    expect(getByText('Switch to manual')).toBeTruthy();
  });

  // M6 (T25 review round 2): "no cache yet" reads a neutral message instead
  // of a confident "not found" — same Switch-to-Manual button either way.
  it('shows a neutral "register not loaded" hint instead, when the cache has never been populated', async () => {
    const { getByText, queryByText } = await render(
      <BondIsinSection
        {...baseProps}
        isin="UA4000234215"
        foundTerms={null}
        registerLoaded={false}
      />,
    );

    expect(getByText('Register not loaded yet.')).toBeTruthy();
    expect(queryByText('Not in the NBU register.')).toBeNull();
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

  // N2 (T25 review round 2, orchestrator ruling): an unmapped-frequency
  // match shows its own picker, with NO chip pre-selected, and blocks Save
  // via the caller's own `couponFrequencyError` until one is picked.
  describe('the coupon-frequency pick (N2)', () => {
    it('renders the picker with a "Select..." placeholder, no chip pre-highlighted, when needsCouponFrequencyPick is true', async () => {
      const { getByText, getByTestId } = await render(
        <BondIsinSection {...baseProps} needsCouponFrequencyPick />,
      );

      expect(getByText('Coupon frequency')).toBeTruthy();
      expect(getByTestId('bond-coupon-frequency-field')).toHaveTextContent('Select a frequency');
    });

    it('does not render the picker when a pick is not needed', async () => {
      const { queryByText } = await render(
        <BondIsinSection {...baseProps} needsCouponFrequencyPick={false} />,
      );

      expect(queryByText('Coupon frequency')).toBeNull();
    });

    it('lists every frequency on trigger press, and reports the tapped one', async () => {
      const onPickCouponFrequency = jest.fn();
      const { getByTestId } = await render(
        <BondIsinSection
          {...baseProps}
          needsCouponFrequencyPick
          onPickCouponFrequency={onPickCouponFrequency}
        />,
      );

      await fireEvent.press(getByTestId('bond-coupon-frequency-field'));

      for (const option of ['monthly', 'quarterly', 'semiannually', 'annually']) {
        expect(getByTestId(`bond-coupon-frequency-field-option-${option}`)).toBeTruthy();
      }

      await fireEvent.press(getByTestId('bond-coupon-frequency-field-option-quarterly'));

      expect(onPickCouponFrequency).toHaveBeenCalledWith('quarterly');
    });

    it('shows the already-picked frequency in the trigger', async () => {
      const { getByTestId } = await render(
        <BondIsinSection
          {...baseProps}
          needsCouponFrequencyPick
          pickedCouponFrequency="quarterly"
        />,
      );

      expect(getByTestId('bond-coupon-frequency-field')).toHaveTextContent('Quarterly');
    });

    it('shows the passed-through coupon-frequency error message', async () => {
      const { getByText } = await render(
        <BondIsinSection
          {...baseProps}
          needsCouponFrequencyPick
          couponFrequencyError="No coupon frequency selected."
        />,
      );

      expect(getByText('No coupon frequency selected.')).toBeTruthy();
    });
  });
});
