export type CategoryOption = { key: string; title: string; icon: string; color: string };

export type CategoryFieldProps = {
  label: string;
  options: readonly CategoryOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
};
