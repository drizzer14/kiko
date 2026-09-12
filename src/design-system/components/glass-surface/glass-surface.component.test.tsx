import { isStableGlass } from '@kiko/screenshot/screenshot-mode';
import { render, within } from '@testing-library/react-native';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';
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
import { MAX_SETTLE_ATTEMPTS } from './glass-surface.resample';

// The minimal shape the first-paint re-sample tests below need from a `View`
// ref/instance — just enough to spy on `measureInWindow`, not the full RN
// native-methods surface.
type MeasureInWindowCallback = (x: number, y: number, width: number, height: number) => void;

type MeasurableInstance = {
  measureInWindow: (callback: MeasureInWindowCallback) => void;
};

// The global jest/setup.js mock renders LiquidGlassView as a plain View and
// pins `isLiquidGlassSupported` to false (the non-glass fallback path). This
// file-level mock keeps the same default so every existing fallback-branch
// test is unchanged, but exposes the flag as a MUTABLE property on the mock
// module object so the glass-capable tests below can flip it on for their own
// scope. The component reads `isLiquidGlassSupported` at render time (a live
// property access, not a load-time snapshot), so flipping it here selects the
// real glass branch without a fresh module registry.
//
// The mock also counts how many times a `LiquidGlassView` instance MOUNTS
// (`baseMountCount`, incremented from a mount-only `useEffect`). This is the
// direct, observable proxy for the production `key={remountToken}` re-sample
// mechanism (`glass-surface.component.tsx`): changing `key` tears down and
// re-mounts the native view, so "mounted twice" IS "remounted exactly once".
// The settle-loop tests below assert on this counter instead of the raw
// `measureInWindow`/`requestAnimationFrame` call count, which floats by one
// across a full `npx jest` run depending on unrelated rAF/timer scheduling
// bleed between suites (flaky in isolation-vs-full-suite runs) even though
// the remount itself always fires exactly once.
jest.mock('@callstack/liquid-glass', () => {
  const { View } = require('react-native');
  const { useEffect, createElement } = require('react');
  const state = { baseMountCount: 0 };
  const LiquidGlassView = (props: ViewProps) => {
    useEffect(() => {
      state.baseMountCount += 1;
    }, []);
    return createElement(View, props);
  };
  return {
    LiquidGlassView,
    isLiquidGlassSupported: false,
    get baseMountCount() {
      return state.baseMountCount;
    },
    resetBaseMountCount: () => {
      state.baseMountCount = 0;
    },
  };
});

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
  baseMountCount: number;
  resetBaseMountCount: () => void;
};

// `isStableGlass()` reads a value react-native-dotenv inlines at BUILD time, so
// it cannot be flipped by mocking `@env` at runtime — mock the screenshot-mode
// module itself. The jest.fn is defined INLINE in the factory (jest.mock is
// hoisted above every top-level statement, so an outer const would not exist
// yet). It defaults to `false` — the production and real-glass marketing value —
// so every existing test above runs the live/fallback tree unchanged; the
// stable-glass describe below flips it on through the imported handle.
jest.mock('@kiko/screenshot/screenshot-mode', () => ({
  isStableGlass: jest.fn(() => false),
}));
const mockIsStableGlass = isStableGlass as jest.Mock;

describe('GlassSurface', () => {
  // Every test defaults to the live/fallback tree (stable-glass OFF, the
  // production + real-glass marketing value); the stable-glass describe flips it
  // on for its own cases and this resets it afterwards.
  beforeEach(() => {
    mockIsStableGlass.mockReturnValue(false);
  });

  it('renders its children (falls back to a plain View under Jest, since @callstack/liquid-glass is mocked with isLiquidGlassSupported: false)', async () => {
    const { getByText } = await render(
      <GlassSurface padding={3}>
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(getByText('content')).toBeTruthy();
  });

  // The tint wash is a normal child element (a plain colored View), not a
  // foreign inline style appended to the PARENT's own style array, so it
  // paints on the very first render the same way `children` always has — no
  // Unistyles-managed style member or ShadowNode-reconciliation gap to route
  // around (the old first-paint-transparent bug an inline style on the
  // parent node used to hit).
  it('renders the wash as a flat backgroundColor on first render when a tint is set', async () => {
    const tint = 'rgba(230, 62, 52, 0.1)';
    const { getByTestId } = await render(
      <GlassSurface testID="tinted-surface" tint={tint}>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('tinted-surface-wash').props.style);
    expect(flat.backgroundColor).toBe(tint);
  });

  it('renders no wash when no tint is set', async () => {
    const { queryByTestId } = await render(
      <GlassSurface testID="plain-surface-2">
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(queryByTestId('plain-surface-2-wash')).toBeNull();
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

  // On the non-glass fallback path a `transparent` surface fills its base with
  // the TRANSLUCENT token (not the opaque `surface`), so this path reads
  // see-through too rather than a solid block. There is no separate backdrop on
  // the fallback path — the base itself carries the fill.
  it('fills the fallback base with the translucent token when transparent is set', async () => {
    const { getByTestId, queryByTestId } = await render(
      <GlassSurface testID="transparent-fallback" transparent>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('transparent-fallback-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(queryByTestId('transparent-fallback-backdrop')).toBeNull();
  });

  // `material` (item 2, BottomSheet's own live-blur variant) must ALSO stay
  // translucent on the non-glass fallback — a device without Liquid Glass
  // has no live-sample material to fall back to, so without this branch the
  // sheet would render as a solid opaque panel there instead of see-through.
  it('fills the fallback base with the translucent token when material is set', async () => {
    const { getByTestId, queryByTestId } = await render(
      <GlassSurface testID="material-fallback" material>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('material-fallback-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(queryByTestId('material-fallback-backdrop')).toBeNull();
  });

  // `bloom` (see the prop doc) must ALSO keep the non-glass fallback fill
  // translucent — the same `surfaceTranslucent` token `transparent`/`material`
  // already use — so a device without Liquid Glass reads see-through too;
  // there is no real optical sampling on that path for `bloom` to strengthen.
  it('fills the fallback base with the translucent token when bloom is set', async () => {
    const { getByTestId, queryByTestId } = await render(
      <GlassSurface testID="bloom-fallback" bloom>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('bloom-fallback-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(queryByTestId('bloom-fallback-backdrop')).toBeNull();
  });

  // The opt-in check: with no `bloom`, the fallback stays the plain opaque
  // theme surface — the translucent fill never applies unasked.
  it('leaves the fallback base as the plain themed surface when bloom is not set', async () => {
    const { getByTestId } = await render(
      <GlassSurface testID="not-bloom-fallback">
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('not-bloom-fallback-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
  });

  // The first-paint re-sample fix (see the "on liquid-glass-capable iOS"
  // describe block below) exists only to force a fresh native
  // `LiquidGlassView` to re-sample — there is no real optical sampling on
  // the non-glass fallback path at all, so `bloom` here must not schedule
  // one even though it is set.
  it('does not schedule a remount for a bloom surface on the non-glass fallback path', async () => {
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    await render(
      <GlassSurface testID="bloom-fallback-resample" bloom>
        <Text>content</Text>
      </GlassSurface>,
    );

    expect(rafSpy).not.toHaveBeenCalled();

    rafSpy.mockRestore();
  });

  // `translucentStrong` (item, the Home transaction card's variant) must ALSO
  // fill the non-glass fallback base with its OWN stronger token, not
  // `transparent`'s — same pattern as the `transparent`/`material` fallback
  // tests above. It must NOT additionally paint the neutral dark `wash`: that
  // layer exists only to fix the REAL glass path (the backdrop-alpha bump was
  // invisible under live glass refraction); the fallback's own base already
  // renders the stronger fill directly, so stacking a second darkening layer
  // on it here would double-darken a path that was never the broken one.
  it('fills the fallback base with the stronger translucent token when translucentStrong is set, with no extra wash', async () => {
    const { getByTestId, queryByTestId } = await render(
      <GlassSurface testID="strong-fallback" translucentStrong>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('strong-fallback-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucentStrong);
    expect(queryByTestId('strong-fallback-backdrop')).toBeNull();
    expect(queryByTestId('strong-fallback-wash')).toBeNull();
  });

  // Combining `bloom` with `translucentStrong` must not disturb the non-glass
  // FALLBACK path: `resolveFallbackFill` checks `isStrong` before `isBloom`,
  // so the fallback keeps the SAME stronger translucent fill either way —
  // there is no real optical sampling on this path for `bloom` to strengthen,
  // and `translucentStrong`'s own token already wins the precedence.
  it('keeps the stronger translucent fallback fill unchanged when bloom is combined with translucentStrong', async () => {
    const { getByTestId, queryByTestId } = await render(
      <GlassSurface testID="strong-bloom-fallback" translucentStrong bloom>
        <Text>content</Text>
      </GlassSurface>,
    );

    const flat = StyleSheet.flatten(getByTestId('strong-bloom-fallback-base').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucentStrong);
    expect(queryByTestId('strong-bloom-fallback-backdrop')).toBeNull();
    expect(queryByTestId('strong-bloom-fallback-wash')).toBeNull();
  });

  // Device-only regression (encoded here as a JS-composition assertion, since
  // Jest renders LiquidGlass as a plain View and cannot reproduce the native
  // glass recomposite): the wash must be a SIBLING layered OVER the base
  // fill, NOT a child of it. When the wash was nested inside the
  // LiquidGlassView it landed in the native UIGlassEffect contentView, so every
  // React commit re-lensed and re-frosted the glass over the thin tint and the
  // card washed out lighter after the first recomposite. The three layers paint
  // back-to-front as direct siblings of the parent surface: base, then wash,
  // then children.
  it('layers the wash as a sibling over the base fill, with children above the wash', async () => {
    const tint = 'rgba(255, 69, 58, 0.1)';
    const { getByTestId } = await render(
      <GlassSurface testID="layered-surface" tint={tint}>
        <Text testID="layered-surface-content">content</Text>
      </GlassSurface>,
    );

    // The wash lives OUTSIDE the base fill layer (it is not nested inside it).
    const base = getByTestId('layered-surface-base');
    expect(within(base).queryByTestId('layered-surface-wash')).toBeNull();
    expect(within(base).queryByTestId('layered-surface-content')).toBeNull();

    // Back-to-front paint order as direct children of the parent surface:
    // base fill, then the wash over it, then children over the wash.
    const order = getByTestId('layered-surface').children.map((child) =>
      typeof child === 'string' ? child : child.props.testID,
    );
    expect(order).toEqual([
      'layered-surface-base',
      'layered-surface-wash',
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
    const tint = 'rgba(255, 69, 58, 0.1)';

    beforeEach(() => {
      liquidGlass.isLiquidGlassSupported = true;
    });
    afterEach(() => {
      liquidGlass.isLiquidGlassSupported = false;
    });

    // `measureInWindow` is a per-instance mock under the RN jest preset
    // (`MockNativeMethods`), but it is assigned on the shared `View` class
    // prototype (Babel's loose class-properties transform), not as an own
    // property of each instance — so spying on ONE instance's prototype (a
    // throwaway probe view, here) controls `measureInWindow` for every `View`
    // rendered afterwards, including the one `GlassSurface` attaches its own
    // `surfaceRef` to.
    let measurableViewPrototype: MeasurableInstance;

    beforeAll(async () => {
      let probeInstance: MeasurableInstance | null = null;
      await render(
        <View
          ref={(node) => {
            probeInstance = node as unknown as MeasurableInstance;
          }}
        />,
      );
      measurableViewPrototype = Object.getPrototypeOf(probeInstance) as MeasurableInstance;
    });

    // The entity tint is composited into the material via the library's own
    // native `tintColor` prop — a fixed tint no recomposite can wash out — fed
    // the card's own `tint`. `animated={false}` stops the frost-in animation
    // replaying when react-native-sortables teleports the dragged card into a
    // portal and remounts a fresh glass view (the pickup flash).
    it('composites the entity tint into the native glass and disables remount animation', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="glass-surface" tint={tint}>
          <Text>content</Text>
        </GlassSurface>,
      );

      const base = getByTestId('glass-surface-base');
      expect(base.props.tintColor).toBe(tint);
      expect(base.props.animated).toBe(false);
    });

    // A tinted card also gets an opaque themed backdrop UNDER the glass so the
    // translucent material samples a FIXED color, not live screen content —
    // pinning the card's lightness across recomposites. It paints first
    // (behind the glass base), then the base, then the wash, then children.
    it('paints an opaque themed backdrop under the glass, behind the base', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="glass-surface" tint={tint}>
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
        'glass-surface-wash',
        'glass-surface-content',
      ]);
    });

    // A tint-less glass surface (settings/statistics sections) carries no
    // entity tint and is not the unstable-card case, so it keeps the live
    // see-through material: no backdrop, no tintColor. It still disables the
    // remount animation.
    it('keeps live glass for a tint-less surface: no backdrop, no tint', async () => {
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

    // `transparent` opts a tint-LESS surface into a TRANSLUCENT themed backdrop
    // (not the opaque one a tinted card gets), WITHOUT any color wash — the
    // frosted see-through panel (the settings and category cards). The backdrop
    // is the translucent themed surface, so the material samples a
    // partially-pinned color and the screen behind reads through.
    it('paints the translucent neutral backdrop for a tint-less surface when transparent is set, with no wash', async () => {
      const { getByTestId, queryByTestId } = await render(
        <GlassSurface testID="transparent-glass" transparent>
          <Text>content</Text>
        </GlassSurface>,
      );

      const backdrop = getByTestId('transparent-glass-backdrop');
      const flat = StyleSheet.flatten(backdrop.props.style);
      expect(flat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);

      // No color wash: the panel stays neutral, and the glass base carries no tint.
      expect(queryByTestId('transparent-glass-wash')).toBeNull();
      expect(getByTestId('transparent-glass-base').props.tintColor).toBeUndefined();
    });

    // `translucentStrong` (the Home transaction card's variant) opts a
    // tint-LESS surface into the STRONGER translucent backdrop —
    // `surfaceTranslucentStrong` (0.80 alpha), not `transparent`'s 0.60 — AND,
    // on this real glass path, an additional NEUTRAL DARK `wash` layered over
    // the finished glass (`surfaceWashStrong`). This is the device-bug fix:
    // the backdrop-alpha bump alone was invisible under the live glass's own
    // refraction, so a second, non-refracted overlay on top of the glass is
    // what actually darkens the card while it stays see-through. No
    // `tintColor` — the wash is neutral, not an entity hue.
    it('paints the stronger translucent neutral backdrop AND the neutral dark wash for a tint-less surface when translucentStrong is set on the real glass path', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="strong-glass" translucentStrong>
          <Text>content</Text>
        </GlassSurface>,
      );

      const backdrop = getByTestId('strong-glass-backdrop');
      const backdropFlat = StyleSheet.flatten(backdrop.props.style);
      expect(backdropFlat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucentStrong);

      const wash = getByTestId('strong-glass-wash');
      const washFlat = StyleSheet.flatten(wash.props.style);
      expect(washFlat.backgroundColor).toBe(darkTheme.colors.surfaceWashStrong);

      expect(getByTestId('strong-glass-base').props.tintColor).toBeUndefined();
    });

    // `transparent` is a NEUTRAL variant, so a `tint` (an entity card, which
    // must stay opaque) always wins: the backdrop is the OPAQUE surface, and the
    // material still carries the entity `tintColor`.
    it('keeps the opaque backdrop and tint when both tint and transparent are set', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="both-glass" tint={tint} transparent>
          <Text>content</Text>
        </GlassSurface>,
      );

      const flat = StyleSheet.flatten(getByTestId('both-glass-backdrop').props.style);
      expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
      expect(getByTestId('both-glass-base').props.tintColor).toBe(tint);
    });

    it('renders no backdrop when neither tint nor transparent is set', async () => {
      const { queryByTestId } = await render(
        <GlassSurface testID="no-backdrop-glass">
          <Text>content</Text>
        </GlassSurface>,
      );

      expect(queryByTestId('no-backdrop-glass-backdrop')).toBeNull();
    });

    // `material` (BottomSheet's own variant — item 2): a REAL translucent
    // blur, so the glass path renders NO backdrop at all — byte-for-byte the
    // same "live sample" tree a plain, tint-less surface already renders
    // (unlike `transparent`, which pins a translucent backdrop under the
    // glass to soften drift on a scrolling card). It carries no tintColor and
    // no wash either.
    it('keeps the live glass material with no backdrop when material is set', async () => {
      const { getByTestId, queryByTestId } = await render(
        <GlassSurface testID="material-glass" material>
          <Text>content</Text>
        </GlassSurface>,
      );

      expect(queryByTestId('material-glass-backdrop')).toBeNull();
      const base = getByTestId('material-glass-base');
      expect(base.props.tintColor).toBeUndefined();
      expect(queryByTestId('material-glass-wash')).toBeNull();
    });

    // `material` is a NEUTRAL variant like `transparent`, so a `tint` (an
    // entity card, which must stay opaque) always wins over it too.
    it('keeps the opaque backdrop and tint when both tint and material are set', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="tinted-material-glass" tint={tint} material>
          <Text>content</Text>
        </GlassSurface>,
      );

      const flat = StyleSheet.flatten(getByTestId('tinted-material-glass-backdrop').props.style);
      expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
      expect(getByTestId('tinted-material-glass-base').props.tintColor).toBe(tint);
    });

    // `translucentStrong` is a NEUTRAL variant like `transparent`/`material`,
    // so a `tint` (an entity card, which must stay opaque) always wins over it
    // too: the backdrop stays the OPAQUE surface, the entity `tintColor` is
    // still applied, and the `wash` stays the entity color — NOT the neutral
    // dark `surfaceWashStrong` overlay, which is `translucentStrong`'s own
    // wash only when no `tint` is set (see `resolveWashFill`).
    it('keeps the opaque backdrop, tint, and entity-color wash when both tint and translucentStrong are set', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="tinted-strong-glass" tint={tint} translucentStrong>
          <Text>content</Text>
        </GlassSurface>,
      );

      const flat = StyleSheet.flatten(getByTestId('tinted-strong-glass-backdrop').props.style);
      expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
      expect(getByTestId('tinted-strong-glass-base').props.tintColor).toBe(tint);

      const washFlat = StyleSheet.flatten(getByTestId('tinted-strong-glass-wash').props.style);
      expect(washFlat.backgroundColor).toBe(tint);
    });

    // `bloom` (see the prop doc) tunes the REAL glass on the real glass path:
    // it OMITS the backdrop entirely (overriding `transparent`'s own partial
    // pin, so the glass samples the real screen behind/adjacent to the card
    // at full strength) and switches the native `UIGlassEffect` style from
    // `'regular'` to `'clear'` — composable with `transparent`, which is
    // exactly the Statistics account-contribution pie card's combination.
    it('removes the backdrop and switches the native glass to the clear style when bloom is set (with transparent)', async () => {
      const { getByTestId, queryByTestId } = await render(
        <GlassSurface testID="bloom-glass" transparent bloom>
          <Text>content</Text>
        </GlassSurface>,
      );

      expect(queryByTestId('bloom-glass-backdrop')).toBeNull();
      expect(getByTestId('bloom-glass-base').props.effect).toBe('clear');
    });

    // FIRST-PAINT RE-SAMPLE (device bug, confirmed 2026-09-12, follow-up fix
    // confirmed 2026-09-12): a `bloom` surface on the real glass path has no
    // backdrop under a `'clear'`-effect `LiquidGlassView`, which samples its
    // backdrop exactly once, at native layout. `GlassSurface` compensates by
    // polling the surface's REAL on-screen position (`measureInWindow`, which
    // includes a `Sortable.Grid` item's live Reanimated transform, unlike
    // `onLayout`) every frame until two consecutive reads agree, then
    // remounting exactly once (`needsResample`/`remountToken`, decision math
    // in `glass-surface.resample.ts`). A fixed 2-frame delay (the original
    // fix) raced this transform and lost for any card whose transform had not
    // yet landed by frame 2 — only cards near the top of the grid happened to
    // settle that fast. These tests drive `measureInWindow` (mocked on the
    // shared `View` prototype — see `probeViewPrototype` above) through a
    // scripted sequence of on-screen reads to prove the loop actually keeps
    // polling past frame 2 rather than assuming a fixed duration.
    describe('bloom re-sample settle loop', () => {
      let measureInWindowSpy: ReturnType<typeof jest.spyOn>;

      beforeEach(() => {
        measureInWindowSpy = jest.spyOn(measurableViewPrototype, 'measureInWindow');
      });

      afterEach(() => {
        measureInWindowSpy.mockRestore();
      });

      // The minimum-latency case (a top-of-grid card, or the previously-safe
      // fixed-2-frame path): the position already matches on the very next
      // read, so the loop settles — and remounts — after exactly two reads,
      // never fewer (a single read has nothing to compare against) and never
      // more.
      it('remounts once two consecutive reads agree, for a card whose position is already settled', async () => {
        const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
          cb(0);
          return 0;
        });

        try {
          measureInWindowSpy.mockImplementation((callback: MeasureInWindowCallback) =>
            callback(0, 100, 0, 0),
          );
          liquidGlass.resetBaseMountCount();

          const { getByTestId, rerender } = await render(
            <GlassSurface testID="bloom-resample-glass" transparent bloom>
              <Text>content</Text>
            </GlassSurface>,
          );

          // The settle loop polled at least twice (a single read can never
          // settle — `isPositionSettled` always requires a prior read to
          // compare against, see `glass-surface.resample.ts`) and then
          // remounted the native glass view exactly once: mounted once on
          // first paint, then a second time when `remountToken` flipped.
          // This is the behavior the loop exists to produce; it is asserted
          // directly (via the mount count) rather than via the raw
          // `measureInWindow`/`requestAnimationFrame` call count, which
          // floats by one across a full `npx jest` run.
          expect(measureInWindowSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
          expect(liquidGlass.baseMountCount).toBe(2);
          expect(getByTestId('bloom-resample-glass-base').props.effect).toBe('clear');

          rerender(
            <GlassSurface testID="bloom-resample-glass" transparent bloom>
              <Text>content</Text>
            </GlassSurface>,
          );

          // Still 2, not 3: the same mounted instance never remounts again
          // once it has already resampled.
          expect(liquidGlass.baseMountCount).toBe(2);
        } finally {
          rafSpy.mockRestore();
        }
      });

      // The confirmed bug scenario: a lower-in-the-grid card's position
      // transform keeps moving past frame 2. The old fixed-2-frame remount
      // would have fired here regardless, sampling nothing solid. The settle
      // loop instead keeps polling — six reads here — until the position
      // finally repeats, and only remounts then.
      it('keeps polling past a fixed 2-frame count while the position keeps moving, and remounts once it settles', async () => {
        const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
          cb(0);
          return 0;
        });

        try {
          const positions = [10, 40, 90, 150, 150, 150];
          let call = 0;
          // `measureInWindow`'s callback recurses synchronously all the way
          // back into another `measureInWindow` call under the mocked,
          // synchronous `requestAnimationFrame` above, so the index must be
          // captured and advanced BEFORE invoking `callback` — advancing it
          // afterwards would read the same stale index on every nested call.
          measureInWindowSpy.mockImplementation((callback: MeasureInWindowCallback) => {
            const index = call;
            call += 1;
            callback(0, positions[index], 0, 0);
          });

          await render(
            <GlassSurface testID="bloom-resample-glass-slow" transparent bloom>
              <Text>content</Text>
            </GlassSurface>,
          );

          // Settles on the 5th read matching the 4th (both 150) — never at
          // frame 2, proving the loop did not assume a fixed duration.
          expect(measureInWindowSpy).toHaveBeenCalledTimes(5);
          expect(rafSpy).toHaveBeenCalledTimes(5);
        } finally {
          rafSpy.mockRestore();
        }
      });

      // The bounded-loop guarantee: a position that never repeats (e.g. a
      // continuously animating card) must not poll forever — the loop caps
      // out at `MAX_SETTLE_ATTEMPTS` and remounts anyway rather than leaving
      // the card unsampled indefinitely.
      it('caps the settle loop and remounts anyway if the position never stops changing', async () => {
        const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
          cb(0);
          return 0;
        });

        try {
          let y = 0;
          measureInWindowSpy.mockImplementation((callback: MeasureInWindowCallback) => {
            y += 1;
            callback(0, y, 0, 0);
          });

          await render(
            <GlassSurface testID="bloom-resample-glass-never-settles" transparent bloom>
              <Text>content</Text>
            </GlassSurface>,
          );

          expect(measureInWindowSpy).toHaveBeenCalledTimes(MAX_SETTLE_ATTEMPTS);
          expect(rafSpy).toHaveBeenCalledTimes(MAX_SETTLE_ATTEMPTS);
        } finally {
          rafSpy.mockRestore();
        }
      });

      // The opt-in check for the re-sample itself: a surface that never sets
      // `bloom` already samples correctly on the first frame (it keeps a real
      // backdrop, or the standard `'regular'` effect), so it must not pay for
      // an extra native remount it does not need.
      it('does not schedule a remount for a non-bloom surface on the real glass path', async () => {
        const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
          cb(0);
          return 0;
        });

        try {
          await render(
            <GlassSurface testID="not-bloom-resample-glass" transparent>
              <Text>content</Text>
            </GlassSurface>,
          );

          expect(rafSpy).not.toHaveBeenCalled();
          expect(measureInWindowSpy).not.toHaveBeenCalled();
        } finally {
          rafSpy.mockRestore();
        }
      });
    });

    // The opt-in check on the real glass path: with no `bloom`, the material
    // keeps the standard `'regular'` style and `transparent`'s own partial
    // pin stays in place — the live-sampling tuning never applies unasked.
    it('keeps the regular glass style and the neutral backdrop when bloom is not set', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="not-bloom-glass" transparent>
          <Text>content</Text>
        </GlassSurface>,
      );

      const backdrop = getByTestId('not-bloom-glass-backdrop');
      const backdropFlat = StyleSheet.flatten(backdrop.props.style);
      expect(backdropFlat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);

      expect(getByTestId('not-bloom-glass-base').props.effect).toBe('regular');
    });

    // `bloom` is a NEUTRAL base-glass property like `transparent`, so a
    // `tint` (an entity card, which must stay pinned and stable) always wins
    // over it too: the backdrop stays the OPAQUE surface, the material
    // carries the entity `tintColor`, and the effect stays `'regular'`.
    it('keeps the opaque backdrop, entity tint, and regular effect when both tint and bloom are set', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="tinted-bloom-glass" tint={tint} bloom>
          <Text>content</Text>
        </GlassSurface>,
      );

      const flat = StyleSheet.flatten(getByTestId('tinted-bloom-glass-backdrop').props.style);
      expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
      expect(getByTestId('tinted-bloom-glass-base').props.tintColor).toBe(tint);
      expect(getByTestId('tinted-bloom-glass-base').props.effect).toBe('regular');
    });

    // The app-wide bloom rollout's key reconciliation: the Home transaction
    // card combines `translucentStrong` (its own stronger backdrop pin + dark
    // wash) with `bloom`. `resolveBackdropFill` checks `isBloom` BEFORE
    // `isStrong`, so `bloom` wins on the backdrop — it is removed entirely,
    // same as a plain `bloom`-only surface, re-admitting the live sample
    // `translucentStrong`'s pin exists to prevent. `resolveWashFill`, by
    // contrast, is driven by `isStrong` alone and never reads `isBloom`, so
    // the neutral dark `surfaceWashStrong` wash keeps painting OVER the now-
    // backdrop-less, `'clear'`-effect glass — COMBINE, not replace: the dark
    // wash stays (for row-text legibility), only the anti-drift backdrop pin
    // is traded away for bloom's live sample.
    it('removes the backdrop and switches to the clear effect but keeps the dark wash when bloom is combined with translucentStrong', async () => {
      const { getByTestId, queryByTestId } = await render(
        <GlassSurface testID="strong-bloom-glass" translucentStrong bloom>
          <Text>content</Text>
        </GlassSurface>,
      );

      expect(queryByTestId('strong-bloom-glass-backdrop')).toBeNull();
      expect(getByTestId('strong-bloom-glass-base').props.effect).toBe('clear');

      const wash = getByTestId('strong-bloom-glass-wash');
      const washFlat = StyleSheet.flatten(wash.props.style);
      expect(washFlat.backgroundColor).toBe(darkTheme.colors.surfaceWashStrong);
    });

    // The app is dark-only, so the native glass's colorScheme is a fixed 'dark'.
    it('passes a fixed dark colorScheme to the native glass', async () => {
      const { getByTestId } = await render(
        <GlassSurface testID="glass-surface" tint="rgba(255,69,58,0.1)">
          <Text>content</Text>
        </GlassSurface>,
      );
      expect(getByTestId('glass-surface-base').props.colorScheme).toBe('dark');
    });
  });

  // STABLE-GLASS regression mode: when `isStableGlass()` is true (the pixelmatch
  // regression build only), GlassSurface renders a FIXED OPAQUE surface with no
  // live LiquidGlass and no bloom, so the check gets byte-stable pixels. It must
  // NOT touch production or the real-glass marketing path — both keep
  // `isStableGlass()` false and render the live tree asserted above.
  describe('under stable-glass regression mode (isStableGlass() true)', () => {
    it('renders a fixed opaque themed base and no backdrop, even on glass-capable iOS', async () => {
      mockIsStableGlass.mockReturnValue(true);
      // Force the glass-capable branch AND request bloom/transparent: stable
      // glass must override all of it with a plain opaque View (no LiquidGlass).
      liquidGlass.isLiquidGlassSupported = true;
      const { getByTestId, queryByTestId } = await render(
        <GlassSurface testID="stable" transparent bloom>
          <Text>content</Text>
        </GlassSurface>,
      );

      const base = getByTestId('stable-base');
      expect(StyleSheet.flatten(base.props.style).backgroundColor).toBe(darkTheme.colors.surface);
      // A plain View, not a LiquidGlassView: no native glass props at all.
      expect(base.props.effect).toBeUndefined();
      expect(base.props.tintColor).toBeUndefined();
      expect(queryByTestId('stable-backdrop')).toBeNull();
      liquidGlass.isLiquidGlassSupported = false;
    });

    it('keeps the entity tint as a flat wash over the opaque base', async () => {
      mockIsStableGlass.mockReturnValue(true);
      const tint = 'rgba(255, 69, 58, 0.1)';
      const { getByTestId } = await render(
        <GlassSurface testID="stable-tint" tint={tint}>
          <Text>content</Text>
        </GlassSurface>,
      );

      expect(StyleSheet.flatten(getByTestId('stable-tint-base').props.style).backgroundColor).toBe(
        darkTheme.colors.surface,
      );
      expect(StyleSheet.flatten(getByTestId('stable-tint-wash').props.style).backgroundColor).toBe(
        tint,
      );
    });

    it('renders the normal live-glass tree when isStableGlass() is false (real-glass marketing / production path unchanged)', async () => {
      mockIsStableGlass.mockReturnValue(false);
      liquidGlass.isLiquidGlassSupported = true;
      const { getByTestId } = await render(
        <GlassSurface testID="live" transparent>
          <Text>content</Text>
        </GlassSurface>,
      );

      // The live path renders a real LiquidGlassView base (has the `effect`
      // prop) — proof stable glass did not hijack the non-regression build.
      expect(getByTestId('live-base').props.effect).toBe('regular');
      liquidGlass.isLiquidGlassSupported = false;
    });
  });
});
