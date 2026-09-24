import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import '../../unistyles';

import ChipRow from '.';

const options = ['bank', 'cash', 'crypto'] as const;

// A chip is a real HIG touch target (44pt tall, minimum) at every
// labelVariant — the default (body) chip meets it through real layout
// (minHeight), and the compact (caption) chip meets it through vertical
// hitSlop around a visually smaller pill, mirroring Button's `small` size.
describe('ChipRow tap target', () => {
  it('holds a 44pt minHeight and no hitSlop at the default (body) labelVariant', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} />,
    );

    const chip = getByText('bank').parent;
    expect(StyleSheet.flatten(chip?.props.style).minHeight).toBe(44);
    expect(chip?.props.hitSlop).toBeUndefined();
  });

  it('restores the 44pt tap target with hitSlop at the caption labelVariant', async () => {
    const { getByText } = await render(
      <ChipRow options={options} selected="bank" onSelect={jest.fn()} labelVariant="caption" />,
    );

    const chip = getByText('bank').parent;
    expect(StyleSheet.flatten(chip?.props.style).minHeight).toBe(34);
    expect(chip?.props.hitSlop).toEqual({ top: 5, bottom: 5 });
  });
});
