export type ChipRowProps<Option extends string> = {
  options: readonly Option[];
  selected: Option;
  onSelect: (option: Option) => void;
};
