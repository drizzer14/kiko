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
  // (e.g. AppearanceSwitch's 3) to force a single row of equal-width cells
  // instead of wrapping.
  columns?: number;
};
