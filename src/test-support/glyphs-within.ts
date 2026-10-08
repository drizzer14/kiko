type RenderedNode = {
  props: Record<string, unknown>;
  children: readonly (RenderedNode | string)[];
};

type Glyph = { name: string; tint: unknown };

const glyphsWithin = (node: RenderedNode): Glyph[] => [
  ...(typeof node.props.fallbackName === 'string'
    ? [{ name: String(node.props.name), tint: node.props.tintColor }]
    : []),
  ...node.children.flatMap((child) => (typeof child === 'string' ? [] : glyphsWithin(child))),
];

// Every SF Symbol name rendered anywhere under `node` — v14 of the testing
// library dropped the by-type queries, and a row's glyph carries no testID.
export const glyphNamesWithin = (node: RenderedNode): string[] =>
  glyphsWithin(node).map((glyph) => glyph.name);

// The `tintColor` of every SF Symbol under `node`, in the same tree order as
// `glyphNamesWithin`, so the two arrays line up per glyph.
export const glyphTintsWithin = (node: RenderedNode): unknown[] =>
  glyphsWithin(node).map((glyph) => glyph.tint);
