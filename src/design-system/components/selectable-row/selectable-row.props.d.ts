import type { ReactNode } from 'react';
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
  // A leading TEXT mark rendered in the SAME leading slot `icon` occupies —
  // for a glyph that has no SF Symbol representation (a currency sign or
  // ISO code, e.g. "$", "AED"). Additive: every existing `icon` (SF Symbol)
  // caller is unaffected. `icon` wins when both are somehow passed — the two
  // are mutually exclusive in practice, no current caller passes both.
  leadingText?: string;
  // Renders the fixed-width icon slot even when `icon` is absent, so a menu
  // mixing icon and icon-less rows keeps every label starting at the same
  // x-position. Defaults to `false`.
  reserveIconSlot?: boolean;
  accessibilityRole?: SelectableRowAccessibilityRole;
  accessibilityLabel?: string;
  // An optional second line rendered below `label`, in the SAME leading-slot-
  // aligned column — the bank picker's capability caption is the first
  // consumer. Wraps onto multiple lines (no truncation) since it sits in a
  // full-width column with nothing else sharing its row. The caller owns any
  // tone switching (e.g. onAccent when selected) on whatever it renders here;
  // SelectableRow does not inspect it.
  description?: ReactNode;
  // An optional trailing node rendered on the SAME line as `label`, pinned to
  // the row's far right edge and top-aligned to the label's first line — the
  // bank picker's capability icons are the first consumer (the icons sit
  // aligned with the title, not inline inside the wrappable `description`
  // caption below it). The caller owns any tone/size choice for whatever it
  // renders here, the same
  // as `description`.
  trailing?: ReactNode;
  // Forwarded to the row's Pressable so a consumer can measure each row's
  // on-screen position (e.g. to auto-scroll to the selected row).
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
};
