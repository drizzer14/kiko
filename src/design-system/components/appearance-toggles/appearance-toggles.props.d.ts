import type { Appearance } from '../../../appearance/appearance';

export type AppearanceTogglesProps = {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
};
