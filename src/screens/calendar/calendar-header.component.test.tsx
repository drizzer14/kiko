import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import CalendarHeader from './calendar-header.component';

describe('CalendarHeader', () => {
  // react-native-calendars hands its custom header an XDate whose getMonth /
  // getFullYear accessors mirror the built-in Date; a plain Date stands in here.
  const march2026 = new Date(2026, 2, 1);

  it('renders the visible month and year as the title', async () => {
    const { getByText } = await render(<CalendarHeader month={march2026} addMonth={jest.fn()} />);

    expect(getByText('March 2026')).toBeTruthy();
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
