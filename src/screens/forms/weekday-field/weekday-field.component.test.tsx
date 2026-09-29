import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import WeekdayField from '.';
import type { WeekdayFieldProps } from './weekday-field.props';

let mockRegion: string | undefined;

jest.mock('@kiko/i18n/device-region/device-region', () => ({
  deviceRegion: () => mockRegion,
}));

const renderField = (overrides: Partial<WeekdayFieldProps> = {}) =>
  render(<WeekdayField label="Days" selected={[]} onChange={jest.fn()} {...overrides} />);

type Screen = Awaited<ReturnType<typeof renderField>>;

const chipTexts = (screen: Screen, onlySelected = false): string[] =>
  screen
    .getAllByRole('button')
    .filter((chip) => !onlySelected || chip.props.accessibilityState?.selected === true)
    .map((chip) => String(within(chip).getByText(/./).props.children));

describe('WeekdayField', () => {
  beforeEach(() => {
    mockRegion = undefined;
  });

  it('lists the week Monday first in a Monday-first region', async () => {
    mockRegion = 'UA';

    const screen = await renderField();

    expect(chipTexts(screen)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('lists the week Sunday first in a Sunday-first region', async () => {
    mockRegion = 'US';

    const screen = await renderField();

    expect(chipTexts(screen)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('marks every picked day as selected', async () => {
    const screen = await renderField({ selected: [5, 1] });

    expect(chipTexts(screen, true)).toEqual(['Mon', 'Fri']);
  });

  it('adds a day on a tap', async () => {
    const onChange = jest.fn();
    const screen = await renderField({ selected: [1], onChange });

    await fireEvent.press(screen.getByText('Wed'));

    expect(onChange).toHaveBeenCalledWith([1, 3]);
  });

  it('removes a picked day on a tap', async () => {
    const onChange = jest.fn();
    const screen = await renderField({ selected: [1, 3], onChange });

    await fireEvent.press(screen.getByText('Mon'));

    expect(onChange).toHaveBeenCalledWith([3]);
  });

  it('shows the label, and the error under the chips only when given', async () => {
    const valid = await renderField();

    expect(valid.getByText('Days')).toBeTruthy();
    expect(valid.queryByText('No days selected.')).toBeNull();

    const invalid = await renderField({ error: 'No days selected.' });

    expect(invalid.getByText('No days selected.')).toBeTruthy();
  });
});
