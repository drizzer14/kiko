import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../unistyles';

import { darkTheme } from '../../theme';

import OptionPills from './option-pills.component';

type TextNode = ReturnType<Awaited<ReturnType<typeof render>>['getByText']>;

// The pill is the label text node's parent Pressable; flatten its style array
// (`[styles.pill, { backgroundColor }]`) to read a merged value back out.
const pillStyleOf = (label: TextNode): Record<string, unknown> =>
  StyleSheet.flatten((label.parent?.props.style ?? {}) as never) as Record<string, unknown>;

describe('OptionPills', () => {
  it('centers the pill content and holds a 44pt touch target (iOS HIG)', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} />,
    );
    const style = pillStyleOf(getByText('30'));

    expect(style.justifyContent).toBe('center');
    expect(style.minHeight).toBe(44);
  });

  it('compacts the caption-variant pill while still reaching a 44pt tap target via hitSlop', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} labelVariant="caption" />,
    );
    const pill = getByText('30').parent;
    const style = pillStyleOf(getByText('30'));

    // Visual height shrinks below the default 44pt floor (item 4: the pill was
    // sized for `body` text around a smaller `caption` label).
    expect(style.minHeight).toBe(34);
    expect(style.paddingVertical).toBe(4);
    // The iOS HIG 44pt tap-target floor is restored via hitSlop, the same
    // pattern Button's `small` size uses: (44 - 34) / 2 = 5pt per edge.
    expect(pill?.props.hitSlop).toEqual({ top: 5, bottom: 5 });
  });

  it('keeps the default body-variant pill at its original 44pt visible height with no hitSlop', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} />,
    );
    const pill = getByText('30').parent;
    const style = pillStyleOf(getByText('30'));

    expect(style.minHeight).toBe(44);
    expect(style.paddingVertical).toBe(8);
    expect(pill?.props.hitSlop).toBeUndefined();
  });

  it('fills the selected pill with the accent color and leaves the rest transparent', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} />,
    );

    // A strong selected state (M3): an accent fill, not a near-invisible raised
    // surface, mirroring the ChipRow selected chip.
    expect(pillStyleOf(getByText('30')).backgroundColor).toBe(darkTheme.colors.accent);
    expect(pillStyleOf(getByText('0')).backgroundColor).toBe('transparent');
  });

  it('renders one pressable pill per option, labelled by String() by default', async () => {
    const { getAllByRole, getByText } = await render(
      <OptionPills options={[0, 30, 60]} selected={30} onSelect={jest.fn()} />,
    );

    expect(getAllByRole('button')).toHaveLength(3);
    expect(getByText('0')).toBeTruthy();
    expect(getByText('60')).toBeTruthy();
  });

  it('uses the label function when given', async () => {
    const { getByText } = await render(
      <OptionPills
        options={['a', 'b'] as const}
        selected="a"
        onSelect={jest.fn()}
        label={(o) => o.toUpperCase()}
      />,
    );

    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
  });

  it('renders an optional leading icon per option', async () => {
    const { toJSON } = await render(
      <OptionPills
        options={['a', 'b'] as const}
        selected="a"
        onSelect={jest.fn()}
        icon={(o) => `icon-${o}`}
      />,
    );

    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('icon-a');
    expect(tree).toContain('icon-b');
  });

  it('marks the selected pill via accessibilityState', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} />,
    );

    expect(getByText('30').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('0').parent?.props.accessibilityState.selected).toBe(false);
  });

  it('reports the pressed option', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={0} onSelect={onSelect} />,
    );

    await fireEvent.press(getByText('30'));

    expect(onSelect).toHaveBeenCalledWith(30);
  });

  // The cell's `style` prop is an array (`[styles.cell, cellWidth]`); flatten
  // it to read the merged `width` back out.
  const flattenStyle = (style: unknown): Record<string, unknown> =>
    Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, unknown>);

  it('defaults each cell to a 50%-wide 2-column grid when `columns` is omitted', async () => {
    const { getByText } = await render(
      <OptionPills options={['a', 'b', 'c'] as const} selected="a" onSelect={jest.fn()} />,
    );

    expect(flattenStyle(getByText('a').parent?.parent?.props.style).width).toBe('50%');
  });

  it('lays out an equal-width single row when `columns` matches the option count', async () => {
    const { getByText } = await render(
      <OptionPills
        options={['a', 'b', 'c'] as const}
        selected="a"
        onSelect={jest.fn()}
        columns={3}
      />,
    );

    expect(flattenStyle(getByText('a').parent?.parent?.props.style).width).toBe(`${100 / 3}%`);
    expect(flattenStyle(getByText('b').parent?.parent?.props.style).width).toBe(`${100 / 3}%`);
    expect(flattenStyle(getByText('c').parent?.parent?.props.style).width).toBe(`${100 / 3}%`);
  });
});
