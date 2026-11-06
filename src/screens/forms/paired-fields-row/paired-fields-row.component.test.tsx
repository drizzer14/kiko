import { render } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { STACK_FONT_SCALE } from '@kiko/design-system/stack-font-scale';

import PairedFieldsRow from './paired-fields-row.component';

const DEFAULT_FONT_SCALE = 2;
const DEFAULT_BODY_POINTS = 17;
const AX1_BODY_POINTS = 28;
const XXX_LARGE_BODY_POINTS = 23;

const renderAt = async (fontScale: number) => {
  Dimensions.set({ window: { ...Dimensions.get('window'), fontScale } });

  return render(<PairedFieldsRow first={<Text>One</Text>} second={<Text>Two</Text>} />);
};

afterEach(() => {
  Dimensions.set({ window: { ...Dimensions.get('window'), fontScale: DEFAULT_FONT_SCALE } });
});

describe('PairedFieldsRow', () => {
  it('stacks from iOS AX1, the first accessibility text size', () => {
    expect(STACK_FONT_SCALE).toBeCloseTo(AX1_BODY_POINTS / DEFAULT_BODY_POINTS, 5);
  });

  it('lays the two fields out in one row of equal columns at the largest regular size', async () => {
    const { getByText } = await renderAt(XXX_LARGE_BODY_POINTS / DEFAULT_BODY_POINTS);
    const cell = getByText('One').parent;
    const row = cell?.parent;

    expect(StyleSheet.flatten(cell?.props.style).flex).toBe(1);
    expect(StyleSheet.flatten(row?.props.style)).toMatchObject({
      flexDirection: 'row',
      gap: darkTheme.spacing(3),
    });
  });

  it('keeps the row up to the size just under AX1', async () => {
    const { getByText } = await renderAt(STACK_FONT_SCALE - 0.01);

    expect(StyleSheet.flatten(getByText('One').parent?.parent?.props.style).flexDirection).toBe(
      'row',
    );
  });

  it('stacks the two fields, first on top, at AX1', async () => {
    const { getByText } = await renderAt(STACK_FONT_SCALE);
    const first = getByText('One');
    const second = getByText('Two');
    const siblings = first.parent?.children ?? [];

    expect(first.parent).toBe(second.parent);
    expect(siblings.indexOf(first)).toBeLessThan(siblings.indexOf(second));
  });
});
