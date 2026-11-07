import { DarkTheme } from '@react-navigation/native';
import { renderHook } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';

import { navigationDarkTheme, navigationLightTheme, useNavigationTheme } from '.';

describe('navigationDarkTheme', () => {
  it('keeps the dark chrome colors: black page and card, white text, accent blue', () => {
    expect(navigationDarkTheme).toEqual({
      dark: true,
      colors: {
        primary: '#0A84FF',
        background: '#000000',
        card: '#000000',
        text: '#FFFFFF',
        border: '#38383A',
        notification: 'rgb(255, 69, 58)',
      },
      fonts: DarkTheme.fonts,
    });
  });
});

describe('useNavigationTheme', () => {
  afterEach(() => {
    restoreThemeOrder();
  });

  it('answers the dark theme, with its dark flag, while dark is the active theme', async () => {
    const { result } = await renderHook(() => useNavigationTheme());

    expect(result.current).toBe(navigationDarkTheme);
    expect(result.current.dark).toBe(true);
  });

  it('answers the light theme, with its dark flag off, while light is the active theme', async () => {
    registerLightThemeFirst();

    const { result } = await renderHook(() => useNavigationTheme());

    expect(result.current).toBe(navigationLightTheme);
    expect(result.current.dark).toBe(false);
  });

  it('follows the theme on a re-render, not the one it first saw', async () => {
    const { result, rerender } = await renderHook(() => useNavigationTheme());

    registerLightThemeFirst();
    await rerender({});

    expect(result.current).toBe(navigationLightTheme);
  });
});
