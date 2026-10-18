import type { HorizontalSizeClass } from '../display-regions-native';

export type LayoutMode = 'single' | 'columns' | 'rows';

// Only the horizontal size class and the window's shape decide the mode, never the device, its
// idiom, or its orientation, so a later device that reports a regular class gets the same rule.
// A square window is a wide one: `columns`.
export const resolveLayoutMode = (
  sizeClass: HorizontalSizeClass,
  width: number,
  height: number,
): LayoutMode => {
  if (sizeClass === 'compact') {
    return 'single';
  }

  return height > width ? 'rows' : 'columns';
};
