import type { TextVariant } from '../text/text.props';

export type OptionPillsProps<T extends string | number> = {
  options: readonly T[];
  selected: T | undefined;
  onSelect: (option: T) => void;
  // Display text for an option. Defaults to `String(option)`.
  label?: (option: T) => string;
  // Optional leading SF Symbol name per option (e.g. the currency-sign glyph in
  // CurrencySwitch). Omitted for a text-only pill row (the lock grace picker).
  icon?: (option: T) => string;
  // Number of equal-width columns the grid wraps at. Defaults to 2 (the
  // original always-2-column grid CurrencySwitch's 4 options and
  // LanguageSwitch's 2 options both rely on). Pass the exact option count
  // (e.g. 3 for a three-option control) to force a single row of equal-width
  // cells instead of wrapping.
  columns?: number;
  // The pill label's `Text` variant. Defaults to `'body'` — the original
  // hardcoded size every existing consumer (CurrencySwitch, LanguageSwitch)
  // still gets unchanged, since neither passes this prop. A caller whose own
  // section label already sits above these values at a larger step (the
  // Statistics trend-filter sheet, which raised its `SectionHeader` to
  // `body`) passes a smaller step here so the value stays visually
  // subordinate to its label. The optional leading icon's size scales with
  // it too (`theme.iconSizes[labelVariant]`), per the design system's "SF
  // Symbol sizing" rule — a glyph stays paired with the type step beside it.
  labelVariant?: TextVariant;
};
