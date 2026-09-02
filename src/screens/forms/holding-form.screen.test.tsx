import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { holdingsRepo } from '../../repositories/holdings.repo';
import HoldingFormScreen from './holding-form.screen';

jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { create: jest.fn().mockResolvedValue(undefined) },
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as never;
const route = { params: { accountId: 'acc-1' } } as never;

describe('HoldingFormScreen term deposit', () => {
  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await render(
      <HoldingFormScreen navigation={navigation} route={route} />,
    );

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add Holding" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add Holding')).toBeNull();
  });

  it('renders a visible text label above every default field', async () => {
    const { getByText } = await render(<HoldingFormScreen navigation={navigation} route={route} />);

    // Card/cash/crypto/jar path: Name, Type, Currency, Balance are the fields.
    expect(getByText('Name')).toBeTruthy();
    expect(getByText('Type')).toBeTruthy();
    expect(getByText('Currency')).toBeTruthy();
    expect(getByText('Balance')).toBeTruthy();
  });

  it('renders a visible text label above every term-deposit field', async () => {
    const { getByText } = await render(<HoldingFormScreen navigation={navigation} route={route} />);

    await fireEvent.press(getByText('term_deposit'));

    for (const label of [
      'Principal',
      'Annual Rate %',
      'Start Date',
      'Term (Months)',
      'Recapitalization',
      'Compounding',
    ]) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it('renders a visible text label above every bond field', async () => {
    const { getByText } = await render(<HoldingFormScreen navigation={navigation} route={route} />);

    await fireEvent.press(getByText('bond'));

    for (const label of ['Quantity', 'Face Value', 'Coupon %', 'Purchase Date', 'Maturity Date']) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it('saves a term_deposit with a metadata block', async () => {
    const { getByLabelText, getByText } = await render(
      <HoldingFormScreen navigation={navigation} route={route} />,
    );

    await fireEvent.press(getByText('term_deposit'));
    await fireEvent.changeText(getByLabelText('Name'), 'My deposit');
    await fireEvent.changeText(getByLabelText('Principal'), '1000');
    await fireEvent.changeText(getByLabelText('Annual Rate %'), '12');
    await fireEvent.changeText(getByLabelText('Start Date'), '2026-01-01');
    await fireEvent.changeText(getByLabelText('Term (Months)'), '12');

    await fireEvent.press(getByText('Save'));

    expect(holdingsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'term_deposit',
        metadata: expect.objectContaining({
          principalMinorUnits: 100_000,
          annualRatePct: 12,
          termMonths: 12,
          recapitalization: expect.any(Boolean),
          compounding: expect.any(String),
        }),
      }),
    );
  });

  it('saves a bond with a metadata block', async () => {
    const { getByLabelText, getByText } = await render(
      <HoldingFormScreen navigation={navigation} route={route} />,
    );

    await fireEvent.press(getByText('bond'));
    await fireEvent.changeText(getByLabelText('Name'), 'My bond');
    await fireEvent.changeText(getByLabelText('Quantity'), '10');
    await fireEvent.changeText(getByLabelText('Face Value'), '1000');
    await fireEvent.changeText(getByLabelText('Coupon %'), '9');
    await fireEvent.changeText(getByLabelText('Purchase Date'), '2026-01-01');
    await fireEvent.changeText(getByLabelText('Maturity Date'), '2028-01-01');

    await fireEvent.press(getByText('Save'));

    expect(holdingsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bond',
        metadata: expect.objectContaining({
          quantity: 10,
          faceValueMinorUnits: 100_000,
          couponPct: 9,
          purchaseDate: Date.parse('2026-01-01'),
          maturityDate: Date.parse('2028-01-01'),
        }),
      }),
    );
  });
});
