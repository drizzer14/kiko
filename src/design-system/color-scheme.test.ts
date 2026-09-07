import { resolveColorScheme } from './color-scheme';

describe('resolveColorScheme', () => {
  it("returns 'light' for the light theme name", () => {
    expect(resolveColorScheme('light')).toBe('light');
  });

  it("returns 'dark' for the dark theme name", () => {
    expect(resolveColorScheme('dark')).toBe('dark');
  });

  it("defaults to 'dark' when the theme name is undefined", () => {
    expect(resolveColorScheme(undefined)).toBe('dark');
  });
});
