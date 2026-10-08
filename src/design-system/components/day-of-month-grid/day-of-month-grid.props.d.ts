export type DayOfMonthGridProps = {
  // The visible caption above the grid, and the group name VoiceOver reads as
  // each day's hint.
  label: string;
  selected: number;
  onSelect: (day: number) => void;
  testID?: string;
};
