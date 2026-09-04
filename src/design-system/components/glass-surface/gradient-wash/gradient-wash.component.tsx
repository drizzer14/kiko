import type { FC } from 'react';
import { StyleSheet as RNStyleSheet } from 'react-native';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';
import type { GradientWashProps } from './gradient-wash.props';

// The `<LinearGradient>` def's own id, referenced by the `<Rect>`'s
// `fill="url(#...)"`. Each `<Svg>` is its own isolated rendering root (like a
// standalone SVG document), so reusing this literal id across many
// simultaneously-rendered cards is safe — it never has to be unique
// app-wide, only within its own `<Svg>`.
const GRADIENT_ID = 'entity-gradient';

// The 45deg entity-color wash: an SVG gradient absolutely filling the surface,
// clipped to its rounded corners by the parent surface's `overflow: hidden`, and
// non-interactive so it never steals a touch from the card's own Pressable.
// `testID`-suffixed `<Stop>` ids let a test assert the resolved stop colors
// without reaching into native SVG internals. See the `gradient` prop docs.
//
// `stopOpacity` is set explicitly on both stops from `gradient.opacity` — NOT
// left to `stopColor`'s own rgba() alpha. react-native-svg's native gradient
// extractor (`extractGradient.ts`) masks a stop's color down to its RGB
// channels and applies opacity ONLY from a separate `stopOpacity` value
// (defaulting to fully opaque when unset), so an rgba() `stopColor` with no
// matching `stopOpacity` renders as a fully opaque, saturated fill regardless
// of the alpha baked into the string — this was the design-review "gradient
// looks like a bright solid color" bug, invisible under Jest because the
// manual `react-native-svg` mock renders `<Stop>` as a passthrough View, not
// through the real native color extractor.
// `viewBox="0 0 100 100"` gives the `<Svg>` a declared, self-contained
// coordinate system, and `preserveAspectRatio="none"` stretches that box to
// whatever frame the surface has. The `<Rect>` then fills the viewBox with
// NUMERIC bounds (`width={100} height={100}`), not `width="100%"`. This is the
// half-gray-wash fix: `absoluteFill` sets `position: 'absolute'`, which makes
// react-native-svg skip its width/height='100%' defaulting, so an SVG with no
// viewBox resolves a Rect's `100%` against the surface's runtime-MEASURED
// bounds. On a card mounting mid-navigation-transition (holding cards, an extra
// wrapper) that measures a partial width, so the color wash covered only part
// of the card and the gray glass showed through the rest. A declared viewBox
// makes the fill independent of wrapper depth and mount timing.
const GradientWash: FC<GradientWashProps> = ({ gradient, testID }) => {
  return (
    <Svg
      style={RNStyleSheet.absoluteFill}
      pointerEvents="none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      testID={testID && `${testID}-gradient-svg`}
    >
      <Defs>
        <LinearGradient id={GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop
            testID={testID && `${testID}-gradient-from`}
            offset="0%"
            stopColor={gradient.from}
            stopOpacity={gradient.opacity}
          />
          <Stop
            testID={testID && `${testID}-gradient-to`}
            offset="100%"
            stopColor={gradient.to}
            stopOpacity={gradient.opacity}
          />
        </LinearGradient>
      </Defs>
      <Rect
        testID={testID && `${testID}-gradient-rect`}
        x={0}
        y={0}
        width={100}
        height={100}
        fill={`url(#${GRADIENT_ID})`}
      />
    </Svg>
  );
};

export default GradientWash;
