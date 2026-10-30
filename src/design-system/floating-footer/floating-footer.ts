import { createContext, useContext } from 'react';

/**
 * True inside the footer of a `Screen` that floats it over its content. A filled `Button` there
 * is a capsule and, on iOS 26+, sits on Liquid Glass (its normal fill below that), because the
 * rows scroll under it with no band behind. False everywhere else.
 */
export const FloatingFooterContext = createContext(false);

export const useIsInFloatingFooter = (): boolean => useContext(FloatingFooterContext);

/**
 * The end padding a scroll view under a floating footer needs so its last row stops at the
 * footer's top edge. A `Screen` pads its own `scroll` content by it; a `bleedTop` or `bleedBottom`
 * child, which owns the scrolling and its padding, reads it here. `undefined` when the screen has
 * no floating footer, so the child keeps its own resting padding.
 */
export const FloatingFooterEndContext = createContext<number | undefined>(undefined);

export const useFloatingFooterEnd = (): number | undefined => useContext(FloatingFooterEndContext);
