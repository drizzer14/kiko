import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

export type PressableButtonProps = {
  onPress: () => void;
  backgroundColor: string;
  disabled?: boolean;
  alignSelf?: ViewStyle['alignSelf'];
  // Rendered before the label/`children` in a horizontal row with a small gap
  // (e.g. a `Symbol`). Optional so existing text-only call sites are unaffected.
  icon?: ReactNode;
  // A plain-text button label the button owns and renders in title case (via a
  // `textTransform`), so button copy reads consistently without each call site
  // styling its own `<Text>`. Prefer this over `children` for a text label; use
  // `children` only when the label needs styling the button does not own (e.g.
  // the currency codes in CurrencySwitch, which vary tone and stay uppercase).
  label?: string;
  children?: ReactNode;
};
