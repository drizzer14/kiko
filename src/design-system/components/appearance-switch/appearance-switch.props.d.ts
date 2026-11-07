import type { AppearanceMode } from '@kiko/appearance/appearance-mode';

export type AppearanceSwitchProps = {
  selected: AppearanceMode;
  onSelect: (mode: AppearanceMode) => void;
};
