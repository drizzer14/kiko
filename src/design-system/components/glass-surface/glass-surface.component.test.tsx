import { render, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
// The border width the surface applies comes from Unistyles' own
// `StyleSheet.hairlineWidth`, which is not necessarily react-native's, so the
// assertion reads the expected value from the same source the style uses.
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '../../unistyles';
import { darkTheme } from '../../theme';
// Imported through the folder's index (the real path a screen consumes,
// `design-system/components/glass-surface`), not `./glass-surface.component`
// directly, so this test also exercises index.ts's re-export.
import GlassSurface from '.';

// The global jest/setup.js mock renders LiquidGlassView as a plain View and
// pins `isLiquidGlassSupported` to false (the non-glass fallback path). This
// file-level mock keeps the same default so every existing fallback-branch
// test is unchanged, but exposes the flag as a MUTABLE property on the mock
// module object so the glass-capable tests below can flip it on for their own
// scope. The component reads `isLiquidGlassSupported` at render time (a live
// property access, not a load-time snapshot), so flipping it here selects the
// real glass branch without a fresh module registry.
jest.mock('@callstack/liquid-glass', () => {
  const { View } = require('react-native');
  return { LiquidGlassView: View, isLiquidGlassSupported: false };
});

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
};

describe('GlassSurface', () => {
  it('renders its children (falls back to a plain View under Jest, since @callstack/liquid-glass is mocked with isLiquidGlassSupported: false)', async () => {
    const { getByText } = await render(
      <GlassSurface padding={3}>
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(getByText('content')).toBeTruthy();
  });

  // The gradient wash is a normal child element (an SVG), not a foreign
  // inline style appended to the style array, so it paints on the very first
  // render the same way `children` always has — no Unistyles-managed style
  // member or ShadowNode-reconciliation gap to route around (unlike the flat
  // `tint` background this replaced, the old first-paint-transparent bug).
  it('renders both gradient stops on first render when a gradient is set', async () => {
    const gradient = {
      from: 'rgba(255, 69, 58, 0.1)',
      to: 'rgba(255, 120, 110, 0.1)',
      opacity: 0.1,
    };
    const { getByTestId } = await render(
      <GlassSurface testID="tinted-surface" gradient={gradient}>
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(getByTestId('tinted-surface-gradient-from').props.stopColor).toBe(gradient.from);
    expect(getByTestId('tinted-surface-gradient-to').props.stopColor).toBe(gradient.to);
  });

  // react-native-svg's native gradient extractor ignores any alpha embedded in
  // a `stopColor` rgba() string and applies opacity ONLY from a separate
  // `stopOpacity` prop (defaulting to fully opaque when unset) — passing the
  // rgba() strings alone silently rendered the wash as a fully opaque,
  // saturated fill on device (the "bright solid color" regression), invisible
  // under Jest's passthrough SVG mock. `stopOpacity` must be set explicitly
  // from `gradient.opacity` on both stops so the wash actually renders
  // translucent.
  it('sets stopOpacity explicitly on both stops from gradient.opacity', async () => {
    const gradient = {
      from: 'rgba(255, 69, 58, 0.1)',
      to: 'rgba(255, 120, 110, 0.1)',
      opacity: 0.1,
    };
    const { getByTestId } = await render(
      <GlassSurface testID="opaque-guard-surface" gradient={gradient}>
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(getByTestId('opaque-guard-surface-gradient-from').props.stopOpacity).toBe(
      gradient.opacity,
    );
    expect(getByTestId('opaque-guard-surface-gradient-to').props.stopOpacity).toBe(
      gradient.opacity,
    );
  });

  // Regression: the wash `<Svg>` uses `absoluteFill`, which sets
  // `position: 'absolute'` and makes react-native-svg skip its width/height
  // '100%' defaulting. Without a declared viewBox, a `<Rect width="100%">`
  // resolves against the surface's runtime-MEASURED bounds, so on a card that
  // mounts mid-navigation-transition it measured a partial width and the color
  // wash covered only part of the card (the half-gray-split bug). The fix is a
  // fixed `viewBox="0 0 100 100"` + `preserveAspectRatio="none"` on the Svg and
  // a NUMERIC `<Rect width={100} height={100}>` that fills that viewBox,
  // independent of wrapper depth or mount timing.
  it('declares a fixed viewBox and preserveAspectRatio="none" on the wash Svg', async () => {
    const gradient = {
      from: 'rgba(255, 69, 58, 0.1)',
      to: 'rgba(255, 120, 110, 0.1)',
      opacity: 0.1,
    };
    const { getByTestId } = await render(
      <GlassSurface testID="viewbox-surface" gradient={gradient}>
        <Text>content</Text>
      </GlassSurface>,
    );

    const svg = getByTestId('viewbox-surface-gradient-svg');
    expect(svg.props.viewBox).toBe('0 0 100 100');
    expect(svg.props.preserveAspectRatio).toBe('none');
  });

  it('fills the wash viewBox with a numeric Rect (never a measured 100% percentage)', async () => {
    const gradient = {
      from: 'rgba(255, 69, 58, 0.1)',
      to: 'rgba(255, 120, 110, 0.1)',
      opacity: 0.1,
    };
    const { getByTestId } = await render(
      <GlassSurface testID="rectfill-surface" gradient={gradient}>
        <Text>content</Text>
      </GlassSurface>,
    );

    const rect = getByTestId('rectfill-surface-gradient-rect');
    expect(rect.props.x).toBe(0);
    expect(rect.props.y).toBe(0);
    expect(rect.props.width).toBe(100);
    expect(rect.props.height).toBe(100);
  });

  it('renders no gradient stops when no gradient is set', async () => {
    const { queryByTestId } = await render(
      <GlassSurface testID="plain-surface-2">
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(queryByTestId('plain-surface-2-gradient-from')).toBeNull();
  });

  // The border must land on the very first render for the same reason as the
  // tint: it flows through a Unistyles-managed style member, so its width/color
  // are written to the native ShadowNode on the first frame rather than only
  // after a re-render (the intermittently-bordered card bug, G2).
  it('draws the hairline separator border on first render when bordered', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="bordered-surface" bordered>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('bordered-surface').props.style);
    expect(flat.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(flat.borderColor).toBe(darkTheme.colors.border);
  });

  it('draws no border when not bordered', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="borderless-surface">
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('borderless-surface').props.style);
    expect(flat.borderWidth).toBeUndefined();
  });

  it('leaves the surface background untinted when no tint is set', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="plain-surface">
        <Text>content</Text>
      </GlassSurface>,
    );

    // The flat themed background now lives on the `-base` fill layer (an
    // absoluteFill sibling), not on the parent surface: it is the theme's
    // `surface` token, never a tint rgba.
    const flat = StyleSheet.flatten(getByTestId('plain-surface-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
  });

  // Device-only regression (encoded here as a JS-composition assertion, since
  // Jest renders LiquidGlass/SVG as plain Views and cannot reproduce the native
  // glass recomposite): the gradient wash must be a SIBLING layered OVER the
  // base fill, NOT a child of it. When the wash was nested inside the
  // LiquidGlassView it landed in the native UIGlassEffect contentView, so every
  // React commit re-lensed and re-frosted the glass over the thin tint and the
  // card washed out lighter after the first recomposite. The three layers paint
  // back-to-front as direct siblings of the parent surface: base, then wash,
  // then children.
  it('layers the wash as a sibling over the base fill, with children above the wash', async () => {
    const gradient = {
      from: 'rgba(255, 69, 58, 0.1)',
      to: 'rgba(255, 120, 110, 0.1)',
      opacity: 0.1,
    };
    const { getByTestId } = await render(
      <GlassSurface testID="layered-surface" gradient={gradient}>
        <Text testID="layered-surface-content">content</Text>
      </GlassSurface>,
    );

    // The wash lives OUTSIDE the base fill layer (it is not nested inside it).
    const base = getByTestId('layered-surface-base');
    expect(within(base).queryByTestId('layered-surface-gradient-svg')).toBeNull();
    expect(within(base).queryByTestId('layered-surface-content')).toBeNull();

    // Back-to-front paint order as direct children of the parent surface:
    // base fill, then the wash over it, then children over the wash.
    const order = getByTestId('layered-surface').children.map((child) =>
      typeof child === 'string' ? child : child.props.testID,
    );
    expect(order).toEqual([
      'layered-surface-base',
      'layered-surface-gradient-svg',
      'layered-surface-content',
    ]);
  });

  // The real Liquid Glass branch (isLiquidGlassSupported === true), which Jest
  // otherwise never reaches because the module is mocked to the non-glass
  // fallback. These assertions encode the device-only stability fix: the card
  // background used to be ~90% a LIVE glass sample of whatever sat behind the
  // card, so its lightness drifted on every scroll/reorder/navigation and it
  // flashed on drag pickup. The fix composites the entity tint INTO the
  // material natively (`tintColor`), pins what the glass samples to a constant
  // opaque `backdrop`, and disables the frost-in animation on remount.
  describe('on liquid-glass-capable iOS', () => {
    const gradient = {
      from: 'rgba(255, 69, 58, 0.1)',
      to: 'rgba(255, 120, 110, 0.1)',
      opacity: 0.1,
    };

    beforeEach(() => {
      liquidGlass.isLiquidGlassSupported = true;
    });
    afterEach(() => {
      liquidGlass.isLiquidGlassSupported = false;
    });

    // The entity tint is composited into the material via the library's own
    // native `tintColor` prop — a fixed tint no recomposite can wash out — fed
    // the card's own `gradient.from`. `animated={false}` stops the frost-in
    // animation replaying when react-native-sortables teleports the dragged
    // card into a portal and remounts a fresh glass view (the pickup flash).
    it('composites the entity tint into the native glass and disables remount animation', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="glass-surface" gradient={gradient}>
          <Text>content</Text>
        </GlassSurface>,
      );

      const base = getByTestId('glass-surface-base');
      expect(base.props.tintColor).toBe(gradient.from);
      expect(base.props.animated).toBe(false);
    });

    // A tinted card also gets an opaque themed backdrop UNDER the glass so the
    // translucent material samples a FIXED color, not live screen content —
    // pinning the card's lightness across recomposites. It paints first
    // (behind the glass base), then the base, then the wash, then children.
    it('paints an opaque themed backdrop under the glass, behind the base', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="glass-surface" gradient={gradient}>
          <Text testID="glass-surface-content">content</Text>
        </GlassSurface>,
      );

      const backdrop = getByTestId('glass-surface-backdrop');
      const flat = StyleSheet.flatten(backdrop.props.style);
      expect(flat.backgroundColor).toBe(darkTheme.colors.surface);

      const order = getByTestId('glass-surface').children.map((child) =>
        typeof child === 'string' ? child : child.props.testID,
      );
      expect(order).toEqual([
        'glass-surface-backdrop',
        'glass-surface-base',
        'glass-surface-gradient-svg',
        'glass-surface-content',
      ]);
    });

    // A gradient-less glass surface (settings/statistics sections) carries no
    // entity tint and is not the unstable-card case, so it keeps the live
    // see-through material: no backdrop, no tintColor. It still disables the
    // remount animation.
    it('keeps live glass for a gradient-less surface: no backdrop, no tint', async () => {
      const { getByTestId, queryByTestId } = await render(
        <GlassSurface testID="plain-glass">
          <Text>content</Text>
        </GlassSurface>,
      );

      expect(queryByTestId('plain-glass-backdrop')).toBeNull();
      const base = getByTestId('plain-glass-base');
      expect(base.props.tintColor).toBeUndefined();
      expect(base.props.animated).toBe(false);
    });
  });
});
