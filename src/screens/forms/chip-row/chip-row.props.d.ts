export type ChipRowProps<Option extends string> = {
  options: readonly Option[];
  selected: Option;
  onSelect: (option: Option) => void;
  // Optional caption rendered above the chips, so a chip row reads as a labeled
  // field alongside the TextField/Switch fields it sits with in a form.
  label?: string;
  // Optional value -> display-text map. A chip whose value is an id-like enum
  // (`term_deposit`, `crypto_asset`) shows human text while `onSelect` still
  // reports the underlying value. A value absent from the map renders verbatim.
  labels?: Partial<Record<Option, string>>;
};
