import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { layoutOf } from '@kiko/test-support/layout-of';
import type { TableCell } from '@kiko/statement-import/column-mapping';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';

import RawPreview from './raw-preview.component';

// A getter, so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
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

// Pins the approved look of the raw-preview expand/collapse link, which the shared
// `ExpandToggle` draws.
describe('RawPreview toggle look', () => {
  it('draws a self-aligned caption accent label beside a caption-sized accent chevron', async () => {
    const { getByTestId } = await render(
      <RawPreview rows={manyRows} headerRowIndex={0} onSelectHeaderRow={jest.fn()} />,
    );
    const toggle = getByTestId('raw-preview-toggle');

    expect(layoutOf(toggle)).toEqual(
      toggleLayout(i18n.t('components.expandToggle.showAll'), 'chevron.down'),
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
      toggleLayout(i18n.t('components.expandToggle.showLess'), 'chevron.up'),
    );
  });
});
