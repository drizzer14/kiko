import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { renderHook } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { OnAccentContext, selectedSurfaceStyles, useIsOnAccent } from '.';

describe('selectedSurfaceStyles', () => {
  it('fills the surface with the accent, border included, so the border keeps its width', () => {
    expect(StyleSheet.flatten(selectedSurfaceStyles.fill)).toEqual({
      backgroundColor: darkTheme.colors.accent,
      borderColor: darkTheme.colors.accent,
    });
  });
});

describe('useIsOnAccent', () => {
  it('is false outside a selected surface', async () => {
    const { result } = await renderHook(() => useIsOnAccent());

    expect(result.current).toBe(false);
  });

  it('is true inside one', async () => {
    const { result } = await renderHook(() => useIsOnAccent(), {
      wrapper: ({ children }) => (
        <OnAccentContext.Provider value>{children}</OnAccentContext.Provider>
      ),
    });

    expect(result.current).toBe(true);
  });
});
