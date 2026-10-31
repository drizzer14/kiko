import { createContext, useContext } from 'react';

/**
 * True inside the footer of a `Screen` that floats it over its content. A filled `Button` there
 * is a capsule and, on iOS 26+, sits on Liquid Glass (below that a tonal one sits on a solid fill
 * and the rest keep their normal, already solid, fill), because the rows scroll under it with no
 * band behind. False everywhere else.
 */
export const FloatingFooterContext = createContext(false);

export const useIsInFloatingFooter = (): boolean => useContext(FloatingFooterContext);

/**
 * The end padding a scroll view under a floating footer needs so its last row stops at the
 * footer's top edge. A `Screen` pads its own `scroll` content by it; a `bleedTop` or `bleedBottom`
 * child, which owns the scrolling and its padding, reads it here. `undefined` when the screen has
 * no floating footer, so the child keeps its own resting padding. Beside a side bar the value has
 * the home-indicator inset taken off, which UIKit adds itself to an `automatic` scroll view
 * (`contentInsetAdjustmentBehavior="automatic"`): it fits only a child in such a scroll view, not
 * a `bleedBottom` child.
 */
export const FloatingFooterEndContext = createContext<number | undefined>(undefined);

export const useFloatingFooterEnd = (): number | undefined => useContext(FloatingFooterEndContext);
