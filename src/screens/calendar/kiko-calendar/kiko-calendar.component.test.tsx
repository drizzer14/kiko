import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import KikoCalendar from './kiko-calendar.component';

// The react-native-calendars mock (jest/setup.js) renders Calendar as a plain
// View that passes every prop through, so these assertions read the props the
// wrapper hands the underlying Calendar.
describe('KikoCalendar', () => {
  it('pins the grid to a fixed six-week height so months never reflow', async () => {
    const { getByTestId } = await render(<KikoCalendar testID="cal" onDayPress={jest.fn()} />);

    const calendar = getByTestId('cal');

    expect(calendar.props.showSixWeeks).toBe(true);
    expect(calendar.props.hideExtraDays).toBe(false);
  });

  it('swaps in the year-jump custom header', async () => {
    const { getByTestId } = await render(<KikoCalendar testID="cal" onDayPress={jest.fn()} />);

    expect(typeof getByTestId('cal').props.customHeader).toBe('function');
  });

  it('forwards day presses, marks, marking type and initial date', async () => {
    const onDayPress = jest.fn();
    const marks = { '2026-03-04': { selected: true } };
    const { getByTestId } = await render(
      <KikoCalendar
        testID="cal"
        onDayPress={onDayPress}
        markedDates={marks}
        markingType="period"
        initialDate="2026-03-01"
      />,
    );

    const calendar = getByTestId('cal');

    expect(calendar.props.onDayPress).toBe(onDayPress);
    expect(calendar.props.markedDates).toBe(marks);
    expect(calendar.props.markingType).toBe('period');
    expect(calendar.props.initialDate).toBe('2026-03-01');
  });

  it('forwards minDate and maxDate so out-of-range days are greyed out', async () => {
    const { getByTestId } = await render(
      <KikoCalendar
        testID="cal"
        onDayPress={jest.fn()}
        minDate="2026-03-01"
        maxDate="2026-03-31"
      />,
    );

    const calendar = getByTestId('cal');

    expect(calendar.props.minDate).toBe('2026-03-01');
    expect(calendar.props.maxDate).toBe('2026-03-31');
  });
});
