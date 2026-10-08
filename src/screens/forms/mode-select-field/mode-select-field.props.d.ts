// The transaction TYPE selector's mode union: a plain income/expense row plus
// the two create-only modes (exchange, split). Co-located here — the domain
// type the field selects — the same way holding-select-field.props owns its
// HoldingSelectOption; the screen imports it back rather than declaring it, so
// the form's mode and the picker that sets it share one source of truth.
export type FormMode = 'income' | 'expense' | 'exchange' | 'split';

export type ModeSelectFieldProps = {
  // Hidden (renders null) while converting — a convert has no mode toggle. Kept
  // as a prop so the screen renders this unconditionally, keeping the `!convert`
  // branch out of the screen component's own cognitive-complexity budget.
  visible: boolean;
  label: string;
  options: readonly FormMode[];
  selected: FormMode;
  onSelect: (mode: FormMode) => void;
  // The catalog-resolved display label for each mode, resolved by the screen
  // (this field calls `t()` only for its own sheet title/placeholder).
  labels: Record<FormMode, string>;
  // The SF Symbol glyph shown for each mode (the trigger's leading icon and each
  // sheet row's leading icon).
  icons: Record<FormMode, string>;
  // A read-only (synced) row disables the field: the trigger is inert and dims
  // like every other locked field, so a bank-owned sign cannot be toggled here.
  disabled: boolean;
};
