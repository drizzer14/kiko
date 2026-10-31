import type { render } from '@testing-library/react-native';

// Derived from `toJSON`'s own signature: the renderer's JSON type is not a declared dependency.
type RenderedTree = ReturnType<Awaited<ReturnType<typeof render>>['toJSON']>;
type RenderedNode = Exclude<RenderedTree, null | unknown[]>;

const collect = (node: RenderedNode | string): string[] => {
  if (typeof node === 'string') {
    return [];
  }

  const own = typeof node.props.testID === 'string' ? [node.props.testID] : [];

  return [...own, ...(node.children ?? []).flatMap(collect)];
};

/**
 * Every testID in a rendered tree, in paint order (a node before its children, a child before its
 * next sibling), so a test asserts what sits above what without depending on how many host views a
 * design-system component wraps its content in.
 */
export const testIdsInOrder = (tree: RenderedTree): string[] => {
  if (tree === null) {
    return [];
  }

  return (Array.isArray(tree) ? tree : [tree]).flatMap(collect);
};
