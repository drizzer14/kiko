import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import CalendarHeader from './calendar-header.component';

const WEEKDAY_ROW_TEST_ID = 'calendar-header-weekdays';
const weekdayLabels = (view: Awaited<ReturnType<typeof render>>): readonly string[] =>
  within(view.getByTestId(WEEKDAY_ROW_TEST_ID))
    .getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
    .map((node) => node.props.children as string);

describe('CalendarHeader', () => {
  // react-native-calendars hands its custom header an XDate whose getMonth /
  // getFullYear accessors mirror the built-in Date; a plain Date stands in here.
  const march2026 = new Date(2026, 2, 1);

  it('renders the visible month and year as the title', async () => {
    const { getByText } = await render(<CalendarHeader month={march2026} addMonth={jest.fn()} />);

    expect(getByText('March 2026')).toBeTruthy();
  });

  it('renders the visible month name from the catalog', async () => {
    // A March date -> the catalog's month label. Under English, 'March'.
    const { getByText } = await render(<CalendarHeader month={march2026} addMonth={jest.fn()} />);

    expect(getByText(/March/)).toBeTruthy();
  });

  it('falls back to the current month when none is provided', async () => {
    const now = new Date();
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const { getByText } = await render(<CalendarHeader addMonth={jest.fn()} />);

    expect(getByText(`${monthNames[now.getMonth()]} ${now.getFullYear()}`)).toBeTruthy();
  });

  it('steps one month back and forward from the single-chevron arrows', async () => {
    const addMonth = jest.fn();
    const { getByLabelText } = await render(
      <CalendarHeader month={march2026} addMonth={addMonth} />,
    );

    await fireEvent.press(getByLabelText('Previous month'));
    await fireEvent.press(getByLabelText('Next month'));

    expect(addMonth).toHaveBeenNthCalledWith(1, -1);
    expect(addMonth).toHaveBeenNthCalledWith(2, 1);
  });

  it('jumps a full year back and forward from the double-chevron arrows', async () => {
    const addMonth = jest.fn();
    const { getByLabelText } = await render(
      <CalendarHeader month={march2026} addMonth={addMonth} />,
    );

    await fireEvent.press(getByLabelText('Previous year'));
    await fireEvent.press(getByLabelText('Next year'));

    expect(addMonth).toHaveBeenNthCalledWith(1, -12);
    expect(addMonth).toHaveBeenNthCalledWith(2, 12);
  });
});

describe('CalendarHeader — first weekday', () => {
  const march2026 = new Date(2026, 2, 1);

  it('starts the weekday row on Sunday when firstDay is 0', async () => {
    const view = await render(
      <CalendarHeader month={march2026} addMonth={jest.fn()} firstDay={0} />,
    );

    expect(weekdayLabels(view)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('starts the weekday row on Sunday when firstDay is omitted (the library default)', async () => {
    const view = await render(<CalendarHeader month={march2026} addMonth={jest.fn()} />);

    expect(weekdayLabels(view)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('rotates the weekday row to start on Monday when firstDay is 1', async () => {
    const view = await render(
      <CalendarHeader month={march2026} addMonth={jest.fn()} firstDay={1} />,
    );

    expect(weekdayLabels(view)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

describe('CalendarHeader — localization', () => {
  const march2026 = new Date(2026, 2, 1);

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the English catalog month name under en', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const { getByText } = await render(<CalendarHeader month={march2026} addMonth={jest.fn()} />);

    expect(getByText('March 2026')).toBeTruthy();
  });

  it('renders the Ukrainian catalog month name under uk', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    const { getByText } = await render(<CalendarHeader month={march2026} addMonth={jest.fn()} />);

    expect(getByText('Березень 2026')).toBeTruthy();
  });
});
