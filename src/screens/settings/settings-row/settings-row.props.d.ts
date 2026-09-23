import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

export type SettingsRowProps = ViewProps & {
  // The SF Symbol name for the row's optional leading icon.
  icon?: string;
  label: string;
  // Present only for a navigating row (e.g. the Categories row) — turns the
  // row into a Pressable and renders the trailing chevron.
  onPress?: () => void;
  // An inline control rendered on the SAME line as the label, pinned to the
  // row's trailing edge and top-aligned to the label's first line — the
  // export screen's "Include saved passwords & keys" Switch is the first
  // consumer (device-feedback-round-3 item 5: a toggle reads as one row with
  // its label, not stacked below it the way a picker/segmented control does).
  // Independent of `onPress`/the chevron — no current row passes both.
  trailing?: ReactNode;
  // Full-width content rendered below the label, for a non-navigating row
  // (e.g. the inline base-currency switch, or a hint caption below a
  // `trailing` toggle).
  children?: ReactNode;
};
