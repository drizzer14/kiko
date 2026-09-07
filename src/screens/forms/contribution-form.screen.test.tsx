import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { Alert } from 'react-native';
import '../../design-system/unistyles';
import { i18n } from '../../i18n';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import ContributionFormScreen from './contribution-form.screen';

type ContributionFormProps = ComponentProps<typeof ContributionFormScreen>;

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

const navigation = navigationSpy();
const route = asRouteProp<ContributionFormProps['route']>('ContributionForm', {
  holdingId: 'h-1',
});

const depositHolding = { id: 'h-1', currency: 'UAH', balanceMinorUnits: 0 };

const seed = (holding: unknown = depositHolding): void => {
  mockUseLiveQuery.mockImplementation(() => ({ data: [holding] }));
};

const renderScreen = () =>
  render(
    <ContributionFormScreen
      navigation={asNavigationProp<ContributionFormProps['navigation']>(navigation)}
      route={route}
    />,
  );

// Local midnight of today — the screen's default date, and the value these
// tests expect when the calendar is not touched.
const today = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

// Drive the DateField calendar: open its sheet, then fire the mocked calendar's
// day-press for the given local day. Mirrors the holding-form date helper.
const pickDate = async (
  utils: Awaited<ReturnType<typeof render>>,
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

  it('shows the holding currency glyph as the amount suffix', async () => {
    const { getByText } = await renderScreen();

    // The seeded holding is UAH, so the amount reads with the hryvnia sign.
    expect(getByText('₴')).toBeTruthy();
  });

  it('shows the amount suffix in the holding own currency, not a fixed one', async () => {
    seed({ id: 'h-1', currency: 'USD', balanceMinorUnits: 0 });

    const { getByText, queryByText } = await renderScreen();

    // A USD holding shows the dollar sign, never the default hryvnia sign.
    expect(getByText('$')).toBeTruthy();
    expect(queryByText('₴')).toBeNull();
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

  it('appends one contribution for a double-tapped Save', async () => {
    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — firing two real
    // `fireEvent.press` calls back to back without awaiting between them trips
    // React's "overlapping act() calls" guard (each is independently wrapped
    // in its own act()), so the two presses are awaited sequentially instead;
    // the guard is still exercised because the write only resolves when this
    // test says so.
    let resolveWrite: () => void = () => {};
    (holdingsRepo.appendDepositContribution as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const utils = await renderScreen();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '1000');

    const save = utils.getByText('Save contribution');

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(holdingsRepo.appendDepositContribution).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this file's beforeEach) clears call history but
    // not a custom mockImplementation — reset it explicitly so it does not
    // leak this test's never-auto-resolving write into the next test.
    (holdingsRepo.appendDepositContribution as jest.Mock).mockReset();
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

describe('ContributionFormScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the amount/date field chrome and save action from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText, queryByText } = await renderScreen();

    expect(getByLabelText('Сума')).toBeTruthy();
    expect(getByLabelText('Дата')).toBeTruthy();
    expect(getByText('Зберегти внесок')).toBeTruthy();
    expect(queryByText('Amount')).toBeNull();
  });

  it('surfaces the failure alert from the Ukrainian catalog', async () => {
    (holdingsRepo.appendDepositContribution as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const utils = await renderScreen();
    await fireEvent.changeText(utils.getByLabelText('Сума'), '1000');
    await fireEvent.press(utils.getByText('Зберегти внесок'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Не вдалося додати внесок', 'Спробуйте ще раз.'),
    );
    alertSpy.mockRestore();
  });
});
