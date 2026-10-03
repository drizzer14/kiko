type RenderedNode = {
  props: Record<string, unknown>;
  children: readonly (RenderedNode | string)[];
};

// Every SF Symbol name rendered anywhere under `node` — v14 of the testing
// library dropped the by-type queries, and a row's glyph carries no testID.
export const glyphNamesWithin = (node: RenderedNode): string[] => [
  ...(typeof node.props.fallbackName === 'string' ? [String(node.props.name)] : []),
  ...node.children.flatMap((child) => (typeof child === 'string' ? [] : glyphNamesWithin(child))),
];
