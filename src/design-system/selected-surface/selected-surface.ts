import { createContext, useContext } from 'react';

import { styles } from './selected-surface.styles';

/**
 * Whether what is drawn here sits on an accent fill. A selected surface (a `Card`, a Settings row)
 * provides it, and `Text` and `SymbolIcon` then take `onAccent` instead of their own tone, so the
 * text, icons and amounts of a selected row read on the fill without each call site passing one.
 */
export const OnAccentContext = createContext(false);

export const useIsOnAccent = (): boolean => useContext(OnAccentContext);

export { styles as selectedSurfaceStyles };
