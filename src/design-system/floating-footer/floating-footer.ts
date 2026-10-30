import { createContext, useContext } from 'react';

/**
 * True inside the footer of a `Screen` that floats it over its content. A filled `Button` there
 * is a capsule and, on iOS 26+, sits on Liquid Glass (its normal fill below that), because the
 * rows scroll under it with no band behind. False everywhere else.
 */
export const FloatingFooterContext = createContext(false);

export const useIsInFloatingFooter = (): boolean => useContext(FloatingFooterContext);
