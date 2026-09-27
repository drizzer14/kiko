import type { TextVariant } from '../text';

// The one shared chips component: a value selection that leaves the form the
// same (see the SegmentedControl entry in kiko-design-system for the
// tabs-vs-chips split). `Option` admits a numeric option set (the Statistics
// trend-filter sheet's Top-N amount pills, `1 | 2 | 3 | 4 | 5`), not just a
// string enum.
export type ChipRowProps<Option extends string | number> = {
  options: readonly Option[];
  // `undefined` (e.g. the Settings language switch before a locale resolves)
  // renders with no chip selected — every other ChipRow consumer keeps
  // passing a concrete value.
  selected: Option | undefined;
  onSelect: (option: Option) => void;
  // Optional caption rendered above the chips, so a chip row reads as a labeled
  // field alongside the TextField/Switch fields it sits with in a form.
  label?: string;
  // Optional value -> display-text map. A chip whose value is an id-like enum
  // (`term_deposit`, `crypto_asset`) shows human text while `onSelect` still
  // reports the underlying value. A value absent from the map renders verbatim.
  labels?: Partial<Record<Option, string>>;
  // The chip label's `Text` variant. Defaults to `'body'` — every consumer
  // that omits it is unchanged. A caller whose value sits under its own
  // larger section label (the Statistics trend-filter sheet's amount/measure
  // rows) passes `'caption'` so the value stays visually subordinate.
  labelVariant?: TextVariant;
};
