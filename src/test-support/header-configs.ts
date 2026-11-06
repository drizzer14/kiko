import type { render } from '@testing-library/react-native';

// Derived from `toJSON`'s own signature: the renderer's JSON type is not a declared dependency.
type RenderedTree = ReturnType<Awaited<ReturnType<typeof render>>['toJSON']>;
type RenderedNode = Exclude<RenderedTree, null | unknown[]>;

const collect = <Props extends object>(node: RenderedNode | string): Props[] => {
  if (typeof node === 'string') {
    return [];
  }

  const inside = (node.children ?? []).flatMap((child) => collect<Props>(child));

  if (node.type !== 'RNSScreenStackHeaderConfig') {
    return inside;
  }

  return [node.props as Props, ...inside];
};

/**
 * The props of every native header config (`RNSScreenStackHeaderConfig`) in a rendered tree, in
 * paint order: what native-stack derives from the merged options and hands to react-native-screens.
 * A test reads the native bar's props from them, since jest draws no UIKit bar. `Props` names the
 * ones the test reads.
 */
export const headerConfigsIn = <Props extends object = Record<string, unknown>>(
  tree: RenderedTree,
): Props[] => {
  if (tree === null) {
    return [];
  }

  return (Array.isArray(tree) ? tree : [tree]).flatMap((node) => collect<Props>(node));
};
