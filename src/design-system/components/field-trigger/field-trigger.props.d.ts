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
  // Suppress the visible caption above the field while keeping `label` as the
  // Pressable's accessibility label. Defaults to false. Set by a caller that
  // already labels the control externally (e.g. a Settings row's own header),
  // so the caption is not shown twice.
  hideLabel?: boolean;
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
  // A leading TEXT mark rendered in place of `icon` — for a glyph with no SF
  // Symbol representation (a currency sign or ISO code, e.g. "$", "AED").
  // Ignored when `icon` is also passed — the two are mutually exclusive in
  // practice, no current caller passes both.
  leadingText?: string;
  // The current selection's display text, or the placeholder copy when
  // nothing is selected yet — the caller resolves which.
  value: string;
  valueTone: FieldTriggerValueTone;
  // Extra content rendered after the value (e.g. a trailing account-name
  // caption) — optional, so a field with nothing to disambiguate omits it.
  trailing?: ReactNode;
  /**
   * Read-only: the trigger renders dimmed and its press is inert. Defaults to
   * false. Used by a field the domain forbids changing after creation (a
   * holding's currency in edit mode).
   */
  disabled?: boolean;
  // The validation-failure message for this field, or `undefined` when it's
  // currently valid — same contract as TextField's/DateField's own `error`.
  // Renders via the shared FieldError directly under the field, and tints
  // the label negative, uniform with every other field type (the reflow
  // error model: no per-field outline; see `FieldError`). REFLOW, not
  // reserve: no error node at all while valid.
  error?: string;
  // Tints the label negative with no error line of its own, for a field whose
  // one error renders under its whole group (a split payment's return rows).
  // Never set beside `error`. Defaults to false.
  invalid?: boolean;
  // An optional testID applied to the Pressable trigger, so a flow can tap the
  // field to open its picker sheet. Omitted leaves the trigger untagged. When
  // set, the FieldError message (when shown) additionally takes
  // `${testID}-error`, matching TextField's derived-testID contract.
  testID?: string;
};
