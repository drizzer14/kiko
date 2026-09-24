import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';

import SegmentedControl from '.';

const options = ['single', 'debitCredit'] as const;

describe('SegmentedControl', () => {
  it('reports the pressed option through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <SegmentedControl options={options} selected="single" onSelect={onSelect} />,
    );

    await fireEvent.press(getByText('debitCredit'));

    expect(onSelect).toHaveBeenCalledWith('debitCredit');
  });

  it('humanizes segment text through the labels map while still reporting the raw value', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={onSelect}
        labels={{ single: 'Single', debitCredit: 'Debit / Credit' }}
      />,
    );

    await fireEvent.press(getByText('Debit / Credit'));

    expect(onSelect).toHaveBeenCalledWith('debitCredit');
  });

  it('marks the selected segment via accessibilityState', async () => {
    const { getByTestId } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        testID="mode-segmented"
      />,
    );

    expect(getByTestId('mode-segmented-option-single').props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
    expect(getByTestId('mode-segmented-option-debitCredit').props.accessibilityState).toEqual({
      selected: false,
      disabled: false,
    });
  });

  it('renders the optional label caption above the segments', async () => {
    const { getByText } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={jest.fn()}
        label="Amount mode"
      />,
    );

    expect(getByText('Amount mode')).toBeTruthy();
  });

  it('ignores a press when disabled', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <SegmentedControl
        options={options}
        selected="single"
        onSelect={onSelect}
        disabled
        testID="mode-segmented"
      />,
    );

    await fireEvent.press(getByTestId('mode-segmented-option-debitCredit'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
