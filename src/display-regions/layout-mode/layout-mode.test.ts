import type { HorizontalSizeClass } from '../display-regions-native';

import { type LayoutMode, resolveLayoutMode } from '.';

describe('resolveLayoutMode', () => {
  it.each<[string, HorizontalSizeClass, number, number, LayoutMode]>([
    ['a compact iPhone in portrait', 'compact', 390, 844, 'single'],
    ['the compact outer Duo window', 'compact', 466, 678, 'single'],
    ['a compact window in landscape', 'compact', 844, 390, 'single'],
    ['a regular window wider than tall (Duo inner, landscape)', 'regular', 951, 669, 'columns'],
    ['a regular window taller than wide (Duo inner, portrait)', 'regular', 669, 951, 'rows'],
    ['a square regular window', 'regular', 700, 700, 'columns'],
    ['a regular window one point wider', 'regular', 701, 700, 'columns'],
    ['a regular window one point taller', 'regular', 700, 701, 'rows'],
  ])('resolves %s', (_name, sizeClass, width, height, expected) => {
    expect(resolveLayoutMode(sizeClass, width, height)).toBe(expected);
  });
});
