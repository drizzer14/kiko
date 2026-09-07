import { StyleSheet } from 'react-native';

import type { RenderedElement } from './rendered-element';

/**
 * Walk up from `node` (inclusive) to the nearest ancestor whose FLATTENED style
 * defines `property`, and return that element.
 *
 * WHY THIS EXISTS: three sheet-padding tests hand-rolled the same
 * `while (node && ...) node = node.parent` walk, then read `.props.style` off a
 * binding TypeScript correctly saw as nullable. Throwing here instead of
 * returning null keeps every call site non-nullable AND turns "no ancestor
 * matched" into a named failure rather than a `Cannot read property 'style' of
 * null` three frames away from the real cause.
 */
export const ancestorWithStyle = (node: RenderedElement, property: string): RenderedElement => {
  let current: RenderedElement | null = node;

  while (current) {
    const style = StyleSheet.flatten(current.props.style) as Record<string, unknown> | undefined;

    if (style?.[property] !== undefined) {
      return current;
    }

    current = current.parent;
  }

  throw new Error(`No ancestor of the given element defines the style property "${property}".`);
};
