import type { ReactNode } from 'react';

// Deliberately narrower than Text's full `TextTone` union (not exported from
// text.props.ts) — a field's value only ever needs to distinguish "a real
// selection" (textPrimary) from "still showing the placeholder"
// (textSecondary).
type FieldTriggerValueTone = 'textPrimary' | 'textSecondary';

export type FieldTriggerProps = {
  // The caption shown above the field AND the Pressable's accessibility
  // label, mirroring every other labeled form field.
  label: string;
  onPress: () => void;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. See the shared FieldLabel.
  required?: boolean;
  // The leading SF Symbol; omitted renders no icon slot at all (used when a
  // caller only shows an icon once something is actually selected).
  icon?: string;
  // An explicit entity-color tint for the icon, overriding its default tone —
  // omitted falls back to SymbolIcon's own tone.
  iconColor?: string;
  // The current selection's display text, or the placeholder copy when
  // nothing is selected yet — the caller resolves which.
  value: string;
  valueTone: FieldTriggerValueTone;
  // Extra content rendered after the value (e.g. a trailing account-name
  // caption) — optional, so a field with nothing to disambiguate omits it.
  trailing?: ReactNode;
};
