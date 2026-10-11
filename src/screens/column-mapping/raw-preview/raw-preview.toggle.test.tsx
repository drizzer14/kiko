import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { layoutOf } from '@kiko/test-support/layout-of';
import type { TableCell } from '@kiko/statement-import/column-mapping';

import RawPreview from './raw-preview.component';

jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('@kiko/test-support/mock-text-variant-tone').default,
}));

const manyRows: TableCell[][] = Array.from({ length: 15 }, (_, index) => [`row-${index}`]);

const toggleLayout = (label: string, chevron: string) => ({
  style: { alignSelf: 'flex-start', paddingVertical: darkTheme.spacing(1) },
  testID: 'raw-preview-toggle',
  children: [
    {
      style: { alignItems: 'center', flexDirection: 'row', gap: darkTheme.spacing(1) },
      children: [
        { variant: 'caption', tone: 'accent', children: [label] },
        {
          style: { height: darkTheme.iconSizes.caption, width: darkTheme.iconSizes.caption },
          symbol: chevron,
          tint: darkTheme.colors.accent,
          testID: 'raw-preview-toggle-chevron',
          children: [],
        },
      ],
    },
  ],
});

// The raw-preview expand/collapse link as drawn today, pinned so the move onto the shared
// `ExpandToggle` provably changes no pixel.
describe('RawPreview toggle look', () => {
  it('draws a self-aligned caption accent label beside a caption-sized accent chevron', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={manyRows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );
    const toggle = getByTestId('raw-preview-toggle');

    expect(layoutOf(toggle)).toEqual(
      toggleLayout(i18n.t('components.pieChart.showAll'), 'chevron.down'),
    );
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.hitSlop).toEqual({ top: 10, bottom: 10 });
  });

  it('keeps the same look with the label and chevron flipped once expanded', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={manyRows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );

    await fireEvent.press(getByTestId('raw-preview-toggle'));

    expect(layoutOf(getByTestId('raw-preview-toggle'))).toEqual(
      toggleLayout(i18n.t('components.pieChart.showLess'), 'chevron.up'),
    );
  });
});
