export type SelectFieldProps<Option extends string> = {
  label: string;
  // The sheet's own header — a DISTINCT string from `label`, Title Case (the
  // sheet-title UI role), never the sentence-case field label reused
  // verbatim: a field label and a sheet title are two different UI roles
  // per kiko-translator's casing-by-role rule.
  sheetTitle: string;
  // Every offered option, in display order.
  options: readonly Option[];
  // `null` = nothing picked yet — renders the `placeholder` as the trigger's
  // value (textSecondary), rather than faking a "no default" state with a
  // `selected=''` value that matches nothing. A caller with an
  // always-populated selection just never passes `null`.
  selected: Option | null;
  onSelect: (option: Option) => void;
  // Runs once, with the pick, after the sheet a pick closed has FINISHED
  // closing (BottomSheet's `onClosed`), never on the pick itself and never for
  // a sheet closed without one. For what must not happen while the sheet is
  // still closing, such as navigating the owning screen away.
  onSelectClosed?: (option: Option) => void;
  // Names the picks whose sheet closes with no animation, so `onSelectClosed`
  // follows the pick at once instead of after the fade. For a pick that leaves
  // the screen, where the fade is only a wait. Every other pick, and a sheet
  // closed without one, keeps the fade; omitted = the fade for all.
  closesWithoutAnimation?: (option: Option) => boolean;
  // The catalog-resolved display label for each option, resolved by the
  // caller so the field stays translation-agnostic.
  labels: Record<Option, string>;
  // An optional second line rendered under each row's label in the sheet —
  // omitted renders a plain one-line SelectableRow.
  subtitles?: Record<Option, string>;
  // An optional leading SF Symbol per option, shown on the trigger AND each
  // sheet row — omitted renders no icon slot.
  icons?: Record<Option, string>;
  // Shown as the trigger's value while `selected` is `null`.
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  // Caps the trigger at the shared select trigger width (`FieldTrigger`'s `capped`), for a field
  // whose value is a short phrase; the trigger is min(column, cap) wide whatever its value. Omitted
  // leaves the trigger as wide as its column.
  capped?: boolean;
  // Same contract as every other field: FieldTrigger renders this under the
  // field (reflow, not reserve) and tints the label negative.
  error?: string;
  // One extra row, shown only while `options` is empty, for the way out of an
  // empty list (create the first option). The caller resolves `label`, so the
  // field stays translation-agnostic. Like a navigating pick, `onPress` runs
  // once after the sheet has FINISHED closing (never on the press itself), and
  // the sheet closes with no animation; it is never reported to `onSelect` or
  // `onSelectClosed`.
  emptyAction?: { label: string; onPress: () => void };
  // The option that reads as "no value" (a "None" pick): while it is selected the trigger's value
  // takes the secondary tone, as it does for a `null` selection.
  emptyOption?: Option;
  testID?: string;
};
