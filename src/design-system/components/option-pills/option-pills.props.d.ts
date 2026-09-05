export type OptionPillsProps<T extends string | number> = {
  options: readonly T[];
  selected: T | undefined;
  onSelect: (option: T) => void;
  // Display text for an option. Defaults to `String(option)`.
  label?: (option: T) => string;
  // Optional leading SF Symbol name per option (e.g. the currency-sign glyph in
  // CurrencySwitch). Omitted for a text-only pill row (the lock grace picker).
  icon?: (option: T) => string;
};
