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

  it('renders a SymbolIcon before each label when the icons map is provided', async () => {
    const icons = {
      bank: 'building.columns',
      cash: 'banknote',
      crypto: 'bitcoinsign',
    } as const;

    const { getByText, toJSON } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} icons={icons} />,
    );

    // Every option still shows its label text...
    expect(getByText('bank')).toBeTruthy();
    // ...and each option's SF Symbol glyph renders. The mocked SFSymbolView
    // forwards `name` to a host View, so each glyph name appears in the tree.
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('building.columns');
    expect(tree).toContain('banknote');
    expect(tree).toContain('bitcoinsign');
  });

  it('renders no glyph when the icons map is absent (text-only default)', async () => {
    const { getByText, toJSON } = await render(
      <ChipRow
        options={options}
        selected="bank"
        onSelect={jest.fn()}
        icons={{ bank: 'building.columns' }}
      />,
    );

    const { toJSON: toJSONTextOnly } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} />,
    );

    // The icons prop is what introduces a glyph: present here, absent below.
    expect(getByText('bank')).toBeTruthy();
    expect(JSON.stringify(toJSON())).toContain('building.columns');
    // Without `icons`, the row stays exactly as its text-only default: no
    // SFSymbolView (which forwards a `name` prop) is rendered for any chip.
    expect(JSON.stringify(toJSONTextOnly())).not.toContain('building.columns');
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

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} label="Kind" required />,
    );

    expect(getByText('*')).toBeTruthy();
  });
});
