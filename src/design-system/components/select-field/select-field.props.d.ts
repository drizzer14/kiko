export type SelectFieldProps<Option extends string> = {
  label: string;
  // Every offered option, in display order.
  options: readonly Option[];
  // `null` = nothing picked yet — renders the `placeholder` as the trigger's
  // value (textSecondary), the same "no default" contract ChipRow's own
  // `selected=''` workaround used to fake (F4 audit item 10). A caller with
  // an always-populated selection just never passes `null`.
  selected: Option | null;
  onSelect: (option: Option) => void;
  // The catalog-resolved display label for each option, resolved by the
  // caller so the field stays translation-agnostic — mirrors ModeSelectField/
  // AccountKindField's own `labels` prop.
  labels: Record<Option, string>;
  // An optional second line rendered under each row's label in the sheet
  // (AccountKindField's own `subtitles`) — omitted renders a plain one-line
  // SelectableRow.
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
  sheetTestID?: string;
};
