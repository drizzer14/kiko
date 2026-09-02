import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { holdingsRepo } from '../../repositories/holdings.repo';
import HoldingFormScreen from './holding-form.screen';

jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { create: jest.fn().mockResolvedValue(undefined) },
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn() } as never;
const route = { params: { accountId: 'acc-1' } } as never;

const createMock = holdingsRepo.create as jest.Mock;

const renderScreen = () => render(<HoldingFormScreen navigation={navigation} route={route} />);

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const fill = async (screen: Screen, label: string, value: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText(label), value);
};

const fillBondFields = async (screen: Screen): Promise<void> => {
  await fireEvent.press(screen.getByText('bond'));
  await fill(screen, 'Name', 'My bond');
  await fill(screen, 'Quantity', '10');
  await fill(screen, 'Face Value', '1000');
  await fill(screen, 'Coupon %', '9');
  await fill(screen, 'Purchase Date', '2026-01-01');
  await fill(screen, 'Maturity Date', '2028-01-01');
};

const metadataOfFirstCreate = (): Record<string, unknown> => createMock.mock.calls[0][0].metadata;

describe('HoldingFormScreen term deposit', () => {
  beforeEach(() => {
    createMock.mockClear();
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add Holding" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add Holding')).toBeNull();
  });

  it('renders a visible text label above every default field', async () => {
    const { getByText } = await renderScreen();

    // Card/cash/crypto/jar path: Name, Type, Currency, Balance are the fields.
    for (const label of ['Name', 'Type', 'Currency', 'Balance']) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it('does not render the opening Balance input for a term deposit', async () => {
    const screen = await renderScreen();

    // Card/cash/crypto/jar show the Balance input.
    expect(screen.getByLabelText('Balance')).toBeTruthy();

    await fireEvent.press(screen.getByText('term_deposit'));

    // A deposit's value derives from its contributions, not an opening balance,
    // so the Balance input is dropped to avoid a dead, misleading field.
    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('renders a visible text label above every term-deposit field', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('term_deposit'));

    // The repeatable contributions list starts with one row.
    expect(screen.getByLabelText('Contribution 1 Amount')).toBeTruthy();
    expect(screen.getByLabelText('Contribution 1 Date')).toBeTruthy();
    expect(screen.getByText('Add contribution')).toBeTruthy();

    for (const label of ['Annual Rate %', 'Term (Months)', 'Recapitalization', 'Compounding']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders a visible text label above every bond field', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('bond'));

    for (const label of [
      'Quantity',
      'Face Value',
      'Coupon %',
      'Purchase Date',
      'Maturity Date',
      'Bond Kind',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('saves a term_deposit with a single contribution in its metadata', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('term_deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await fill(screen, 'Contribution 1 Date', '2026-01-01');
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.principalMinorUnits).toBeUndefined();
    expect(metadata.startDate).toBeUndefined();
    expect(metadata.annualRatePct).toBe(12);
    expect(metadata.termMonths).toBe(12);
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: Date.parse('2026-01-01') },
    ]);
  });

  it('creates a deposit with two contributions', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('term_deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await fill(screen, 'Contribution 1 Date', '2026-01-01');

    await fireEvent.press(screen.getByText('Add contribution'));

    await fill(screen, 'Contribution 2 Amount', '500');
    await fill(screen, 'Contribution 2 Date', '2026-02-01');
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.contributions).toHaveLength(2);
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: Date.parse('2026-01-01') },
      { amountMinorUnits: 50_000, date: Date.parse('2026-02-01') },
    ]);
  });

  it('persists only the filled row when a blank contribution row is left empty', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('term_deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await fill(screen, 'Contribution 1 Date', '2026-01-01');

    // Add a second row but leave it blank.
    await fireEvent.press(screen.getByText('Add contribution'));

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: Date.parse('2026-01-01') },
    ]);
  });

  it('does not save a deposit when no contribution row is valid', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('term_deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
  });

  it('removes a contribution row via its remove control', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('term_deposit'));
    await fireEvent.press(screen.getByText('Add contribution'));

    expect(screen.getByLabelText('Contribution 2 Amount')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Remove contribution 2'));

    expect(screen.queryByLabelText('Contribution 2 Amount')).toBeNull();
  });

  it('saves a bond with a metadata block', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate()).toEqual(
      expect.objectContaining({
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 9,
        purchaseDate: Date.parse('2026-01-01'),
        maturityDate: Date.parse('2028-01-01'),
        bondKind: 'government',
      }),
    );
  });

  it('creates a corporate bond when the corporate chip is selected', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    await fireEvent.press(screen.getByText('corporate'));

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().bondKind).toBe('corporate');
  });
});
