type RenderedNode = {
  props: Record<string, unknown>;
  children: readonly (RenderedNode | string)[];
};

// The `tintColor` of every SF Symbol rendered anywhere under `node`, in the
// same tree order as `glyphNamesWithin`, so the two arrays line up per glyph.
export const glyphTintsWithin = (node: RenderedNode): unknown[] => [
  ...(typeof node.props.fallbackName === 'string' ? [node.props.tintColor] : []),
  ...node.children.flatMap((child) => (typeof child === 'string' ? [] : glyphTintsWithin(child))),
];
