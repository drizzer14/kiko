import type { HorizontalSizeClass } from '../display-regions-native';

import { type LayoutMode, resolveLayoutMode } from '.';

describe('resolveLayoutMode', () => {
  it.each<[string, HorizontalSizeClass, number, number, LayoutMode]>([
    ['a compact iPhone in portrait', 'compact', 390, 844, 'single'],
    ['the compact outer Duo window', 'compact', 466, 678, 'single'],
    ['a compact window in landscape', 'compact', 844, 390, 'single'],
    ['a regular window wider than tall (Duo inner, landscape)', 'regular', 951, 669, 'columns'],
    ['a regular window taller than wide (Duo inner, portrait)', 'regular', 669, 951, 'rows'],
    ['a square regular window', 'regular', 721, 721, 'columns'],
    ['a regular window one point wider', 'regular', 722, 721, 'columns'],
    ['a regular window one point taller', 'regular', 721, 722, 'rows'],
    ['a square regular window below two minimum panes', 'regular', 700, 700, 'single'],
    ['a narrow wide regular window below two minimum panes', 'regular', 720, 500, 'single'],
    ['a wide regular window at two minimum panes and a divider', 'regular', 721, 500, 'columns'],
    ['a tall regular window below two minimum panes', 'regular', 500, 720, 'single'],
    ['a tall narrow regular window with room for two panes', 'regular', 400, 900, 'rows'],
    ['a 13-inch-class landscape regular window', 'regular', 1366, 1024, 'columns'],
  ])('resolves %s', (_name, sizeClass, width, height, expected) => {
    expect(resolveLayoutMode(sizeClass, width, height)).toBe(expected);
  });

  it.each<[string, HorizontalSizeClass, number, number, LayoutMode]>([
    ['the outer window', 'compact', 466, 678, 'single'],
    ['the inner window in landscape', 'regular', 951, 669, 'columns'],
    ['the inner window in portrait', 'regular', 669, 951, 'rows'],
  ])('Duo poses never single: %s', (_name, sizeClass, width, height, expected) => {
    expect(resolveLayoutMode(sizeClass, width, height)).toBe(expected);
  });
});
