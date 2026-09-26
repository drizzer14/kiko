import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import '../../unistyles';

import ChipRow from '.';

const options = ['bank', 'cash', 'crypto'] as const;

// The visible chip height plus its vertical hitSlop: the real tap target.
const tapTargetHeight = (chip: { props: { style: unknown; hitSlop?: unknown } } | null) => {
  const slop = (chip?.props.hitSlop ?? { top: 0, bottom: 0 }) as { top: number; bottom: number };

  return StyleSheet.flatten(chip?.props.style).minHeight + slop.top + slop.bottom;
};

// A chip keeps the compact visible size at every labelVariant, and reaches the
// HIG 44pt tap target through vertical hitSlop, never through a taller visual,
// mirroring Button's `small` size.
describe('ChipRow tap target', () => {
  it.each(['body', 'caption'] as const)(
    'draws a compact 34pt chip and restores the 44pt tap target with hitSlop at the %s labelVariant',
    async (labelVariant) => {
      const { getByText } = await render(
        <ChipRow
          options={options}
          selected="bank"
          onSelect={jest.fn()}
          labelVariant={labelVariant}
        />,
      );

      const chip = getByText('bank').parent;
      const style = StyleSheet.flatten(chip?.props.style);
      expect(style.minHeight).toBe(34);
      expect(style.paddingVertical).toBe(4);
      expect(chip?.props.hitSlop).toEqual({ top: 5, bottom: 5 });
      expect(tapTargetHeight(chip)).toBe(44);
    },
  );
});
