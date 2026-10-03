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
  // Same contract as every other field: FieldTrigger renders this under the
  // field (reflow, not reserve) and tints the label negative.
  error?: string;
  testID?: string;
};
