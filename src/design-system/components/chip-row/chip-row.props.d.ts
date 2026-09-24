import type { TextVariant } from '../text/text.props';

// Codebase-review decision 24: the one shared chips component (this used to
// be ChipRow's compact sibling to a separate, near-duplicate
// `design-system/components/option-pills`, both a selectable pill row with
// an accent fill and an `onAccent` label — merged here, in ChipRow's own
// compact F3 look, so `Option` widens to admit a numeric option set (the
// Statistics trend-filter sheet's Top-N amount pills, `1 | 2 | 3 | 4 | 5`).
export type ChipRowProps<Option extends string | number> = {
  options: readonly Option[];
  // `undefined` (absorbed from `OptionPills`, e.g. the Settings language
  // switch before a locale resolves) renders with no chip selected — every
  // existing ChipRow consumer keeps passing a concrete value.
  selected: Option | undefined;
  onSelect: (option: Option) => void;
  // Optional caption rendered above the chips, so a chip row reads as a labeled
  // field alongside the TextField/Switch fields it sits with in a form.
  label?: string;
  // When true (and a label is set), the label shows a red asterisk marking the
  // field as required. Defaults to false. See the shared FieldLabel.
  required?: boolean;
  // Optional value -> display-text map. A chip whose value is an id-like enum
  // (`term_deposit`, `crypto_asset`) shows human text while `onSelect` still
  // reports the underlying value. A value absent from the map renders verbatim.
  labels?: Partial<Record<Option, string>>;
  // Optional value -> SF Symbol name map. When supplied, each chip renders the
  // named glyph before its label; only the ENTITY selects use this (account
  // Kind, holding Type). A value absent from the map renders text-only, so an
  // omitted `icons` prop leaves the row exactly as its text-only default.
  icons?: Partial<Record<Option, string>>;
  // When true, the row is read-only: presses are inert and the chips are dimmed.
  // The edit forms use this for a field the domain forbids changing after
  // creation (an account's kind, a holding's type/currency) — it still SHOWS the
  // stored value's selected chip, but cannot switch it.
  disabled?: boolean;
  // The chip label's `Text` variant, absorbed from the former `OptionPills`
  // (decision 24 merge). Defaults to `'body'` — every pre-merge ChipRow
  // consumer that omits it is unchanged. A caller whose value sits under its
  // own larger section label (the Statistics trend-filter sheet's amount/
  // measure rows) passes `'caption'` so the value stays visually subordinate.
  labelVariant?: TextVariant;
};
