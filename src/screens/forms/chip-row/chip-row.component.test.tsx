import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
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

  it('is inert and dimmed when disabled: presses do not fire onSelect', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={onSelect} disabled />,
    );

    // A disabled chip reports its disabled a11y state and swallows the press so
    // the domain-forbidden field (an account kind / holding type / currency)
    // cannot be switched after creation.
    const chip = getByText('cash').parent;
    expect(chip?.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(getByText('cash'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('applies a dimmed opacity to the chip row while disabled', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} disabled />,
    );

    // The whole row dims to read as fixed; the row is the grandparent of a chip's
    // label Text (label -> Pressable chip -> row Box).
    const row = getByText('bank').parent?.parent;
    expect(StyleSheet.flatten(row?.props.style).opacity).toBe(0.5);
  });

  it('leaves the chip row at full opacity when enabled', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} />,
    );

    const row = getByText('bank').parent?.parent;
    expect(StyleSheet.flatten(row?.props.style).opacity).toBeUndefined();
  });
});
