import { createContext, useContext } from 'react';

/**
 * True inside the footer of a `Screen` that floats it over its content. A tonal `Button` there
 * draws on Liquid Glass (a solid fill below iOS 26) instead of its translucent tint, because the
 * rows scroll under it with no band behind. False everywhere else.
 */
export const FloatingFooterContext = createContext(false);

export const useIsInFloatingFooter = (): boolean => useContext(FloatingFooterContext);
