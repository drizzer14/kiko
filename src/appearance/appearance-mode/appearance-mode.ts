import type { SettingsRow } from '@kiko/db';

export type AppearanceMode = SettingsRow['appearance'];

// Chip order, left to right: System sits between the two pinned modes. Nothing reads an index.
export const appearanceModes = [
  'light',
  'system',
  'dark',
] as const satisfies readonly AppearanceMode[];

// The column is a TypeScript-only enum, so a hand-built or restored row can hold any text; the
// hook and the control read the mode through this, never the raw column.
export const parseAppearanceMode = (value: unknown): AppearanceMode =>
  appearanceModes.find((mode) => mode === value) ?? 'system';

const windowOverrides = {
  system: 'auto',
  light: 'light',
  dark: 'dark',
} as const satisfies Record<AppearanceMode, 'light' | 'dark' | 'auto'>;

/** The `Appearance.setColorScheme` argument for a mode; `auto` hands the window back to the OS. */
export const windowOverrideOf = (mode: AppearanceMode): 'light' | 'dark' | 'auto' =>
  windowOverrides[mode];
