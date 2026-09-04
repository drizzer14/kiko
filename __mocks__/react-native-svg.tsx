// Manual mock for `react-native-svg`, picked up automatically by Jest for
// every test (no `jest.mock('react-native-svg')` call needed — see
// https://jestjs.io/docs/manual-mocks#mocking-node-modules).
//
// Two problems make the real package unusable under Jest. Its package.json
// "react-native" export condition resolves to raw TypeScript source
// (`src/index.ts`), which Jest's RN preset does not transform (it is not in
// jest.config.js's transformIgnorePatterns exemption list), so an unmocked
// import fails to parse. Its elements are also native host views with no
// software renderer under react-test-renderer. This mock renders every SVG
// primitive the chart components use as a plain View that preserves `testID`
// and its other props, so a test can query the rendered polylines/arcs/legend
// entries by testID and read back the geometry props.

import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

type SvgElementProps = Record<string, unknown> & { children?: ReactNode };

const SvgElement = ({ children, ...props }: SvgElementProps): ReactNode => {
  return <View {...props}>{children}</View>;
};

// SVG `<Text>` differs from the other primitives above: it legally holds a raw
// string child (the rendered number). A passthrough `<View>` cannot — RN throws
// "Text strings must be rendered within a <Text>" — so the mock renders SVG
// `<Text>` as an RN `<Text>` instead, still forwarding `testID` and every other
// prop so a test can query it and read back its geometry/fill.
const SvgTextElement = ({ children, ...props }: SvgElementProps): ReactNode => {
  return <RNText {...props}>{children}</RNText>;
};

export default SvgElement;

export const Svg = SvgElement;

export const Path = SvgElement;

export const Rect = SvgElement;

export const Polyline = SvgElement;

export const Line = SvgElement;

export const G = SvgElement;

export const Circle = SvgElement;

export const Text = SvgTextElement;

// Added for GlassSurface's 45deg entity-color gradient wash (design system
// item F3): `Defs`/`LinearGradient`/`Stop` render as the same passthrough
// View, so a test can still query a `<Stop testID="..." stopColor="..." />`
// by its testID and read back the resolved color, the same pattern the chart
// components above already use for their own geometry props.
export const Defs = SvgElement;

export const LinearGradient = SvgElement;

export const Stop = SvgElement;
