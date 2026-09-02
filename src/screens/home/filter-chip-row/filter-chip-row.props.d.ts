export type FilterChipRowProps = {
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
};
