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
import { View } from 'react-native';

type SvgElementProps = Record<string, unknown> & { children?: ReactNode };

const SvgElement = ({ children, ...props }: SvgElementProps): ReactNode => {
  return <View {...props}>{children}</View>;
};

export default SvgElement;

export const Svg = SvgElement;

export const Path = SvgElement;

export const Rect = SvgElement;

export const Polyline = SvgElement;

export const Line = SvgElement;

export const G = SvgElement;

export const Circle = SvgElement;

export const Text = SvgElement;
