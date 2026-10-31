import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import FooterGlassBacking from '.';

// The glass is a stand-in that shows the props the backing gives it, so the test reads the
// native tint and the clear-glass flag without a native view.
jest.mock('@kiko/design-system/components/glass-surface', () => {
  const { View: MockView } = require('react-native');

  return {
    __esModule: true,
    default: (props: { glassTint?: string; transparent?: boolean }) => (
      <MockView
        testID="backing-glass"
        accessibilityLabel={props.glassTint ?? 'no-glass-tint'}
        accessibilityHint={props.transparent === true ? 'transparent' : 'regular'}
      />
    ),
  };
});

jest.mock('@callstack/liquid-glass', () => ({
  LiquidGlassView: 'LiquidGlassView',
  isLiquidGlassSupported: true,
}));

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
};

describe('FooterGlassBacking', () => {
  afterEach(() => {
    liquidGlass.isLiquidGlassSupported = true;
  });

  it.each([
    ['primary', darkTheme.colors.accent],
    ['secondary', darkTheme.colors.surfaceHigh],
    ['destructive', darkTheme.colors.negative],
  ] as const)(
    'tints the glass of a %s button natively and adds no tone layer',
    async (variant, color) => {
      const view = await render(<FooterGlassBacking variant={variant} />);
      const glass = view.getByTestId('backing-glass');

      expect(glass.props.accessibilityLabel).toBe(color);
      expect(glass.props.accessibilityHint).toBe('regular');
      expect(view.getByTestId('footer-glass-backing').children).toHaveLength(1);
    },
  );

  it.each([
    ['secondaryTonal', darkTheme.colors.neutralSubtle],
    ['destructiveTonal', darkTheme.colors.negativeSubtle],
  ] as const)(
    'puts the %s tone View over clear glass with no glass tint',
    async (variant, tone) => {
      const view = await render(<FooterGlassBacking variant={variant} />);
      const glass = view.getByTestId('backing-glass');
      const layerChildren = view.getByTestId('footer-glass-backing').children;
      const toneLayer = layerChildren.find(
        (child) => typeof child !== 'string' && child.props.testID !== 'backing-glass',
      );

      expect(glass.props.accessibilityLabel).toBe('no-glass-tint');
      expect(glass.props.accessibilityHint).toBe('transparent');
      expect(layerChildren).toHaveLength(2);
      expect(
        typeof toneLayer === 'string' ? undefined : StyleSheet.flatten(toneLayer?.props.style),
      ).toMatchObject({ backgroundColor: tone });
    },
  );

  it.each([
    ['secondaryTonal', darkTheme.colors.neutralSubtle],
    ['destructiveTonal', darkTheme.colors.negativeSubtle],
  ] as const)(
    'puts the %s tone View over an opaque background fill and no glass below iOS 26',
    async (variant, tone) => {
      liquidGlass.isLiquidGlassSupported = false;

      const view = await render(<FooterGlassBacking variant={variant} />);
      const layerChildren = view.getByTestId('footer-glass-backing').children;
      const fills = layerChildren.map((child) =>
        typeof child === 'string' ? undefined : StyleSheet.flatten(child.props.style),
      );

      expect(view.queryByTestId('backing-glass')).toBeNull();
      expect(layerChildren).toHaveLength(2);
      expect(fills[0]).toMatchObject({ backgroundColor: darkTheme.colors.background });
      expect(fills[1]).toMatchObject({ backgroundColor: tone });
    },
  );

  it('ignores touches and masks the capsule corners', async () => {
    const view = await render(<FooterGlassBacking variant="primary" />);
    const layer = view.getByTestId('footer-glass-backing');
    const flat = StyleSheet.flatten(layer.props.style);

    expect(layer.props.pointerEvents).toBe('none');
    expect(flat.borderRadius).toBe(darkTheme.radii.full);
    expect(flat.overflow).toBe('hidden');
  });
});
