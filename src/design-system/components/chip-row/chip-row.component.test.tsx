import { fireEvent, render } from '@testing-library/react-native';

import '../../unistyles';

import ChipRow from '.';

const options = ['bank', 'cash', 'crypto'] as const;

describe('ChipRow', () => {
  it('reports the pressed option through onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={onSelect} />,
    );

    await fireEvent.press(getByText('cash'));

    expect(onSelect).toHaveBeenCalledWith('cash');
  });

  it('humanizes chip text through the labels map while still reporting the raw value', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <ChipRow
        options={options}
        selected="bank"
        onSelect={onSelect}
        labels={{ crypto: 'Crypto Wallet' }}
      />,
    );

    await fireEvent.press(getByText('Crypto Wallet'));

    expect(onSelect).toHaveBeenCalledWith('crypto');
  });

  it('marks the selected chip via accessibilityState', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="cash" onSelect={jest.fn()} />,
    );

    expect(getByText('cash').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('bank').parent?.props.accessibilityState.selected).toBe(false);
  });
});
