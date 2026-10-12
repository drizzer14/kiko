import { StyleSheet } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';

import type { RenderedElement } from './rendered-element';

export type LayoutNode = {
  style?: unknown;
  symbol?: string;
  tint?: string;
  testID?: string;
  variant?: string;
  tone?: string;
  children: (LayoutNode | string)[];
};

/**
 * The look-defining shape of a rendered subtree: each host node's flattened style, its SF Symbol
 * name and tint, testID, and (when a test mocks `Text` to pass them through) its `variant` and
 * `tone`, with the text leaves as strings.
 *
 * WHY THIS EXISTS: a refactor that moves JSX into a shared component must keep the rendered
 * tree and every style identical. One `toEqual` against this shape pins all of it at once, where
 * a style assertion per node would leave the nesting unchecked.
 */
export const layoutOf = (node: RenderedElement | string): LayoutNode | string => {
  if (typeof node === 'string') {
    return node;
  }

  return {
    ...foldMap(maybe(StyleSheet.flatten(node.props.style)), (style) => ({ style })),
    ...foldMap(maybe(node.props.name), (symbol) => ({ symbol: String(symbol) })),
    ...foldMap(maybe(node.props.tintColor), (tint) => ({ tint: String(tint) })),
    ...foldMap(maybe(node.props.testID), (testID) => ({ testID: String(testID) })),
    ...foldMap(maybe(node.props.variant), (variant) => ({ variant: String(variant) })),
    ...foldMap(maybe(node.props.tone), (tone) => ({ tone: String(tone) })),
    children: node.children.map(layoutOf),
  };
};
