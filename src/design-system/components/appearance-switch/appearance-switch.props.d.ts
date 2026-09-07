import type { Appearance } from '../../../appearance/appearance';

export type AppearanceSwitchProps = {
  selected: Appearance | undefined;
  onSelect: (appearance: Appearance) => void;
};
