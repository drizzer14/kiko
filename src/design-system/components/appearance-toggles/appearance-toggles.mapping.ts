import type { Appearance } from '../../../appearance/appearance';

// Follow ON always persists 'system' (the OS drives the scheme); Follow OFF
// pins the concrete scheme from the Dark switch.
export const appearanceFromToggles = (followSystem: boolean, darkOn: boolean): Appearance => {
  if (followSystem) {
    return 'system';
  }

  return darkOn ? 'dark' : 'light';
};

// Derive the two switch positions for the current setting. While following the
// system, the Dark switch is a read-only REFLECTION of the live OS-resolved
// scheme (resolvedScheme); when pinned, it reflects the pinned choice itself.
export const togglesFromAppearance = (
  appearance: Appearance,
  resolvedScheme: 'light' | 'dark',
): { followSystem: boolean; darkOn: boolean } => {
  if (appearance === 'system') {
    return { followSystem: true, darkOn: resolvedScheme === 'dark' };
  }

  return { followSystem: false, darkOn: appearance === 'dark' };
};
