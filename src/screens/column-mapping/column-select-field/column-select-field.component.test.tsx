import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import ColumnSelectField from './column-select-field.component';

const options = [
  { value: 0, label: 'Date' },
  { value: 1, label: 'Description' },
  { value: 2, label: 'Amount' },
];

describe('ColumnSelectField', () => {
  it('shows the placeholder when nothing is selected', async () => {
    const { getByText } = await render(
      <ColumnSelectField
        label="Date"
        options={options}
        selected={undefined}
        onSelect={jest.fn()}
        placeholder="Select a date column"
      />,
    );

    expect(getByText('Select a date column')).toBeTruthy();
  });

  it("shows the selected option's own label as the field's value", async () => {
    const { getByText } = await render(
      <ColumnSelectField
        label="Date"
        options={options}
        selected={1}
        onSelect={jest.fn()}
        placeholder="Select a date column"
      />,
    );

    expect(getByText('Description')).toBeTruthy();
  });

  it('opens a sheet listing every option, and calls onSelect with the tapped value', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <ColumnSelectField
        label="Date"
        options={options}
        selected={undefined}
        onSelect={onSelect}
        placeholder="Select a date column"
        testID="date-column-field"
      />,
    );

    await fireEvent.press(getByTestId('date-column-field'));
    await fireEvent.press(getByTestId('date-column-field-option-2'));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('offers a "Not used" row that selects undefined, only when allowNotUsed is set', async () => {
    const onSelect = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ColumnSelectField
        label="Counterparty"
        options={options}
        selected={0}
        onSelect={onSelect}
        allowNotUsed
        placeholder="Select a counterparty column"
        testID="counterparty-field"
      />,
    );

    await fireEvent.press(getByTestId('counterparty-field'));

    expect(queryByTestId('counterparty-field-not-used')).toBeTruthy();
    await fireEvent.press(getByTestId('counterparty-field-not-used'));

    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it('renders no "Not used" row when allowNotUsed is omitted (a required field)', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ColumnSelectField
        label="Date"
        options={options}
        selected={0}
        onSelect={jest.fn()}
        placeholder="Select a date column"
        testID="date-column-field"
      />,
    );

    await fireEvent.press(getByTestId('date-column-field'));

    expect(queryByTestId('date-column-field-not-used')).toBeNull();
  });
});
