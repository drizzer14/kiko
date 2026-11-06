import { useUnistyles } from 'react-native-unistyles';

import type { ColorScheme } from '../palette';

// The scheme of the theme in force, read off the theme's own field. A theme object is never
// compared by reference: `useUnistyles` hands out a proxy, so only a field survives a re-render.
export const useActiveColorScheme = (): ColorScheme => useUnistyles().theme.colorScheme;
