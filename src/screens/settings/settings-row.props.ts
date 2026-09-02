import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

export type SettingsRowProps = ViewProps & {
  // The SF Symbol name for the row's optional leading icon.
  icon?: string;
  label: string;
  // Present only for a navigating row (e.g. the Categories row) — turns the
  // row into a Pressable and renders the trailing chevron.
  onPress?: () => void;
  // Full-width content rendered below the label, for a non-navigating row
  // (e.g. the inline base-currency switch).
  children?: ReactNode;
};
