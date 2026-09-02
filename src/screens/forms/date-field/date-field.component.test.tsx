import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { formatDate } from '../../../dates/format';
import DateField from './date-field.component';

describe('DateField', () => {
  it('shows the placeholder while no date is picked', async () => {
    const { getByText } = await render(
      <DateField label="Start Date" value={null} onChange={jest.fn()} placeholder="Pick a day" />,
    );

    expect(getByText('Pick a day')).toBeTruthy();
  });

  it('shows the picked date as DD.MM.YYYY', async () => {
    const value = new Date(2026, 0, 15).getTime();
    const { getByText } = await render(
      <DateField label="Start Date" value={value} onChange={jest.fn()} />,
    );

    expect(getByText(formatDate(value))).toBeTruthy();
  });

  it('opens the calendar and reports the picked day as a local-midnight timestamp', async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByTestId } = await render(
      <DateField label="Start Date" value={null} onChange={onChange} />,
    );

    await fireEvent.press(getByLabelText('Start Date'));
    await fireEvent(getByTestId('Start Date calendar'), 'dayPress', {
      year: 2026,
      month: 3,
      day: 4,
      dateString: '2026-03-04',
      timestamp: 0,
    });

    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 4).getTime());
  });
});
