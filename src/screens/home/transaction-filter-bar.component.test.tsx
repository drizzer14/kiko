import { act, fireEvent, render } from '@testing-library/react-native';
import { formatDate } from '../../dates/format';
import '../../design-system/unistyles';
import TransactionFilterBar, { FILTER_ALL } from './transaction-filter-bar.component';

type BarProps = {
  selectedAccount?: Set<string>;
  selectedCategory?: Set<string>;
  onToggleAccount?: (value: string) => void;
  onToggleCategory?: (value: string) => void;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  minDate?: Date;
  maxDate?: Date;
  onApplyDates?: (from: Date | null, to: Date | null) => void;
  onClearDates?: () => void;
};

const SPAN_START = new Date(2026, 0, 1);
const SPAN_END = new Date(2026, 8, 2);

const renderBar = (props: BarProps = {}): ReturnType<typeof render> =>
  render(
    <TransactionFilterBar
      accounts={['Monobank', 'PrivatBank']}
      categories={['Food', 'Transport']}
      selectedAccount={props.selectedAccount ?? new Set<string>()}
      selectedCategory={props.selectedCategory ?? new Set<string>()}
      onToggleAccount={props.onToggleAccount ?? jest.fn()}
      onToggleCategory={props.onToggleCategory ?? jest.fn()}
      dateFrom={props.dateFrom ?? null}
      dateTo={props.dateTo ?? null}
      minDate={props.minDate ?? SPAN_START}
      maxDate={props.maxDate ?? SPAN_END}
      onApplyDates={props.onApplyDates ?? jest.fn()}
      onClearDates={props.onClearDates ?? jest.fn()}
    />,
  );

type BarRender = Awaited<ReturnType<typeof renderBar>>;

// The filter dropdowns are custom sheets: press the anchor (its testID) to open,
// then each option is a checkbox row at `${testID}-option-${value}`. `fireEvent`
// wraps the resulting state update in `act`.
const openMenu = async (getByTestId: (id: string) => unknown, testID: string): Promise<void> => {
  await act(async () => {
    fireEvent.press(getByTestId(testID) as Parameters<typeof fireEvent.press>[0]);
  });
};

const pressOption = async (
  getByTestId: (id: string) => unknown,
  testID: string,
  value: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.press(
      getByTestId(`${testID}-option-${value}`) as Parameters<typeof fireEvent.press>[0],
    );
  });
};

// A DateData object matching react-native-calendars' onDayPress payload, built
// from a Date (month is 1-based on the payload).
const dateData = (date: Date): Record<string, unknown> => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
  timestamp: date.getTime(),
  dateString: '',
});

const pressDay = async (queries: BarRender, date: Date): Promise<void> => {
  await act(async () => {
    queries.getByTestId('date-range-calendar').props.onDayPress(dateData(date));
  });
};

describe('TransactionFilterBar', () => {
  describe('accounts dropdown', () => {
    it('labels the control "Accounts" when nothing is selected', async () => {
      const { getByText } = await renderBar();

      expect(getByText('Accounts')).toBeTruthy();
    });

    it('shows the active selection count on the accounts control', async () => {
      const { getByText } = await renderBar({ selectedAccount: new Set(['Monobank']) });

      expect(getByText('Accounts · 1')).toBeTruthy();
    });

    it('keeps the dropdown closed until the anchor is pressed', async () => {
      const { queryByTestId } = await renderBar();

      expect(queryByTestId('account-filter-menu-option-Monobank')).toBeNull();
    });

    it('lists an All option plus one per account when opened', async () => {
      const { getByTestId, queryByTestId } = await renderBar();

      await openMenu(getByTestId, 'account-filter-menu');

      expect(queryByTestId(`account-filter-menu-option-${FILTER_ALL}`)).toBeTruthy();
      expect(queryByTestId('account-filter-menu-option-Monobank')).toBeTruthy();
      expect(queryByTestId('account-filter-menu-option-PrivatBank')).toBeTruthy();
    });

    it('marks a selected account option as checked', async () => {
      const { getByTestId } = await renderBar({ selectedAccount: new Set(['Monobank']) });

      await openMenu(getByTestId, 'account-filter-menu');

      expect(
        getByTestId('account-filter-menu-option-Monobank').props.accessibilityState?.checked,
      ).toBe(true);
      expect(
        getByTestId('account-filter-menu-option-PrivatBank').props.accessibilityState?.checked,
      ).toBe(false);
    });

    it('marks the All option checked when no account is selected', async () => {
      const { getByTestId } = await renderBar();

      await openMenu(getByTestId, 'account-filter-menu');

      expect(
        getByTestId(`account-filter-menu-option-${FILTER_ALL}`).props.accessibilityState?.checked,
      ).toBe(true);
    });

    it('routes an account option press to onToggleAccount with the account name', async () => {
      const onToggleAccount = jest.fn();
      const { getByTestId } = await renderBar({ onToggleAccount });

      await openMenu(getByTestId, 'account-filter-menu');
      await pressOption(getByTestId, 'account-filter-menu', 'PrivatBank');

      expect(onToggleAccount).toHaveBeenCalledWith('PrivatBank');
    });

    it('routes the All option press to onToggleAccount with FILTER_ALL', async () => {
      const onToggleAccount = jest.fn();
      const { getByTestId } = await renderBar({ onToggleAccount });

      await openMenu(getByTestId, 'account-filter-menu');
      await pressOption(getByTestId, 'account-filter-menu', FILTER_ALL);

      expect(onToggleAccount).toHaveBeenCalledWith(FILTER_ALL);
    });

    it('stays open after an option is toggled so several can be picked in one pass', async () => {
      const { getByTestId, queryByTestId } = await renderBar();

      await openMenu(getByTestId, 'account-filter-menu');
      await pressOption(getByTestId, 'account-filter-menu', 'Monobank');

      expect(queryByTestId('account-filter-menu-option-PrivatBank')).toBeTruthy();
    });

    it('closes only on an explicit tap-outside (backdrop)', async () => {
      const { getByTestId, queryByTestId } = await renderBar();

      await openMenu(getByTestId, 'account-filter-menu');
      await act(async () => {
        fireEvent.press(getByTestId('account-filter-menu-backdrop'));
      });

      expect(queryByTestId('account-filter-menu-option-Monobank')).toBeNull();
    });
  });

  describe('categories dropdown', () => {
    it('labels the control "Categories" when nothing is selected', async () => {
      const { getByText } = await renderBar();

      expect(getByText('Categories')).toBeTruthy();
    });

    it('shows the active selection count on the categories control', async () => {
      const { getByText } = await renderBar({
        selectedCategory: new Set(['Food', 'Transport']),
      });

      expect(getByText('Categories · 2')).toBeTruthy();
    });

    it('routes a category option press to onToggleCategory with the category name', async () => {
      const onToggleCategory = jest.fn();
      const { getByTestId } = await renderBar({ onToggleCategory });

      await openMenu(getByTestId, 'category-filter-menu');
      await pressOption(getByTestId, 'category-filter-menu', 'Food');

      expect(onToggleCategory).toHaveBeenCalledWith('Food');
    });
  });

  describe('date-range field', () => {
    it('displays the full transaction span when no range is active', async () => {
      const { getByText } = await renderBar();

      expect(getByText(`${formatDate(SPAN_START)} – ${formatDate(SPAN_END)}`)).toBeTruthy();
    });

    it('displays the active range bounds joined by an en dash when a range is set', async () => {
      const from = new Date(2026, 0, 5);
      const to = new Date(2026, 0, 20);
      const { getByText } = await renderBar({ dateFrom: from, dateTo: to });

      expect(getByText(`${formatDate(from)} – ${formatDate(to)}`)).toBeTruthy();
    });

    it('keeps the calendar sheet closed until the field is pressed', async () => {
      const { queryByText } = await renderBar();

      expect(queryByText('Apply')).toBeNull();
    });

    it('opens a sheet with a single range calendar and Apply/Clear actions', async () => {
      const { getByText, getByLabelText, getByTestId } = await renderBar();

      await act(async () => {
        fireEvent.press(getByLabelText('Date range'));
      });

      expect(getByTestId('date-range-calendar')).toBeTruthy();
      expect(getByText('Apply')).toBeTruthy();
      expect(getByText('Clear')).toBeTruthy();
    });

    it('applies the preselected span directly when Apply is pressed without a fresh tap', async () => {
      const onApplyDates = jest.fn();
      const { getByText, getByLabelText } = await renderBar({ onApplyDates });

      await act(async () => {
        fireEvent.press(getByLabelText('Date range'));
      });
      await act(async () => {
        fireEvent.press(getByText('Apply'));
      });

      expect(onApplyDates).toHaveBeenCalledWith(SPAN_START, SPAN_END);
    });

    it('applies a range selected across two day taps, ordered from <= to', async () => {
      const onApplyDates = jest.fn();
      const queries = await renderBar({ onApplyDates });

      await act(async () => {
        fireEvent.press(queries.getByLabelText('Date range'));
      });
      // Tap the later day first, then the earlier day: the field must still
      // commit the range with from <= to.
      await pressDay(queries, new Date(2026, 0, 20));
      await pressDay(queries, new Date(2026, 0, 5));
      await act(async () => {
        fireEvent.press(queries.getByText('Apply'));
      });

      expect(onApplyDates).toHaveBeenCalledWith(new Date(2026, 0, 5), new Date(2026, 0, 20));
    });

    it('commits a single tapped day as a same-day range', async () => {
      const onApplyDates = jest.fn();
      const queries = await renderBar({ onApplyDates });

      await act(async () => {
        fireEvent.press(queries.getByLabelText('Date range'));
      });
      await pressDay(queries, new Date(2026, 0, 7));
      await act(async () => {
        fireEvent.press(queries.getByText('Apply'));
      });

      expect(onApplyDates).toHaveBeenCalledWith(new Date(2026, 0, 7), new Date(2026, 0, 7));
    });

    it('clears the range when Clear is pressed', async () => {
      const onClearDates = jest.fn();
      const { getByText, getByLabelText } = await renderBar({
        dateFrom: new Date(2026, 0, 5),
        onClearDates,
      });

      await act(async () => {
        fireEvent.press(getByLabelText('Date range'));
      });
      await act(async () => {
        fireEvent.press(getByText('Clear'));
      });

      expect(onClearDates).toHaveBeenCalledTimes(1);
    });
  });
});
