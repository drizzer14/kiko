import { renderHook } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';

import { useActiveColorScheme } from './active-color-scheme';

describe('useActiveColorScheme', () => {
  afterEach(() => {
    restoreThemeOrder();
  });

  it('answers dark while dark is the active theme', async () => {
    const { result } = await renderHook(() => useActiveColorScheme());

    expect(result.current).toBe('dark');
  });

  it('answers light while light is the active theme', async () => {
    registerLightThemeFirst();

    const { result } = await renderHook(() => useActiveColorScheme());

    expect(result.current).toBe('light');
  });

  it('follows the theme on a re-render, not the one it first saw', async () => {
    const { result, rerender } = await renderHook(() => useActiveColorScheme());

    registerLightThemeFirst();
    await rerender({});

    expect(result.current).toBe('light');
  });
});
