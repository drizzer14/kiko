import type { RenderedElement } from './rendered-element';

const textsWithin = (node: RenderedElement | string): string[] =>
  typeof node === 'string' ? [node] : node.children.flatMap(textsWithin);

/**
 * The trailing text a `TextField` renders after `input` (its `suffix`: a
 * currency glyph or a unit), or `null` when it renders none.
 *
 * WHY THIS EXISTS: a form shows the same unit ("%", "g") beside several
 * fields, so a bare `getByText('%')` cannot tell WHICH field carries it. This
 * reads only what follows the given input inside its own container — call it
 * before a failed Save, since a shown field error also follows the input.
 */
export const fieldSuffix = (input: RenderedElement): string | null => {
  const siblings = input.parent?.children ?? [];
  const text = siblings
    .slice(siblings.indexOf(input) + 1)
    .flatMap(textsWithin)
    .join('');

  return text === '' ? null : text;
};
