import { StyleSheet } from 'react-native';

import { ancestorWithStyle } from './ancestor-with-style';
import type { RenderedElement } from './rendered-element';

/**
 * The `gap` of the nearest ancestor ABOVE `element` that defines one.
 *
 * WHY THIS EXISTS: a field's error line must sit under the same `Box gap={1}` that a TextField
 * gives its own. Starting above the error row skips the row's own icon gap, and a walk by style
 * (not by a fixed `.parent` count) keeps the pin alive when FieldError's inner layout changes.
 */
export const gapAbove = (element: RenderedElement): unknown => {
  if (!element.parent) {
    throw new Error('The given element has no ancestor to read a gap from.');
  }

  return StyleSheet.flatten(ancestorWithStyle(element.parent, 'gap').props.style).gap;
};
