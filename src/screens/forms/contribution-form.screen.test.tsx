import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { holdingsRepo } from '../../repositories/holdings.repo';
import ContributionFormScreen from './contribution-form.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    appendDepositContribution: jest.fn(),
  },
}));

const navigation = { goBack: jest.fn(), setOptions: jest.fn() } as never;
const route = { params: { holdingId: 'h-1' } } as never;

const depositHolding = { id: 'h-1', currency: 'UAH', balanceMinorUnits: 0 };

const seed = (holding: unknown = depositHolding): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: [holding] }));
};

const renderScreen = () => render(<ContributionFormScreen navigation={navigation} route={route} />);

// Local midnight of today — the screen's default date, and the value these
// tests expect when the calendar is not touched.
const today = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

// Drive the DateField calendar: open its sheet, then fire the mocked calendar's
// day-press for the given local day. Mirrors the holding-form date helper.
const pickDate = async (
  utils: ReturnType<typeof render>,
  year: number,
  month: number,
  day: number,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Date'));
  await fireEvent(utils.getByTestId('Date calendar'), 'dayPress', {
    year,
    month,
    day,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: 0,
  });
};

describe('ContributionFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed();
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
  });

  it('appends the entered amount at the picked date and navigates back', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '1000');
    await pickDate(utils, 2025, 6, 1);
    await fireEvent.press(utils.getByText('Save contribution'));

    // 1,000.00 UAH -> 100,000 minor units; the picked day lands at LOCAL
    // midnight, matching DateField and the interest boundaries.
    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledWith('h-1', {
      amountMinorUnits: 100_000,
      date: new Date(2025, 5, 1).getTime(),
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('defaults the date to today when the calendar is not touched', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '250');
    await fireEvent.press(utils.getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledWith('h-1', {
      amountMinorUnits: 25_000,
      date: today(),
    });
  });

  it('groups the amount with spaces as the user types and still parses it on save', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '1000000');
    expect(utils.getByLabelText('Amount').props.value).toBe('1 000 000');

    await fireEvent.press(utils.getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledWith(
      'h-1',
      expect.objectContaining({ amountMinorUnits: 100_000_000 }),
    );
  });

  it('does not append when the amount is blank', async () => {
    const utils = await renderScreen();

    await fireEvent.press(utils.getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('does not append when the amount is zero', async () => {
    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '0');
    await fireEvent.press(utils.getByText('Save contribution'));

    expect(holdingsRepo.appendDepositContribution).not.toHaveBeenCalled();
  });

  it('surfaces an alert and does not navigate when the append fails', async () => {
    (holdingsRepo.appendDepositContribution as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '1000');
    await fireEvent.press(utils.getByText('Save contribution'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
