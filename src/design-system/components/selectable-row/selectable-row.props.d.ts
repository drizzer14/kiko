import type { LayoutChangeEvent } from 'react-native';

type SelectableRowAccessibilityRole = 'button' | 'checkbox';

export type SelectableRowProps = {
  selected: boolean;
  onPress: () => void;
  label: string;
  // The leading SF Symbol name, rendered after the check slot. Optional — a
  // row with no `icon` still reserves the icon slot's width when
  // `reserveIconSlot` is set, so labels stay aligned across a mixed menu.
  icon?: string;
  // The icon's tint when NOT selected. Ignored once selected: the icon then
  // switches to the always-white `onAccent` tone (the design system's
  // onAccent rule for a glyph on a filled accent surface).
  iconColor?: string;
  // Renders the fixed-width icon slot even when `icon` is absent, so a menu
  // mixing icon and icon-less rows keeps every label starting at the same
  // x-position. Defaults to `false`.
  reserveIconSlot?: boolean;
  accessibilityRole?: SelectableRowAccessibilityRole;
  accessibilityLabel?: string;
  // Forwarded to the row's Pressable so a consumer can measure each row's
  // on-screen position (e.g. to auto-scroll to the selected row).
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
};
