export type SegmentedControlProps<Option extends string> = {
  options: readonly Option[];
  selected: Option;
  onSelect: (option: Option) => void;
  // Optional value -> display-text map. A segment whose value is an id-like
  // enum (`debitCredit`, `fixed`) shows human text while `onSelect` still
  // reports the underlying value. A value absent from the map renders
  // verbatim.
  labels?: Partial<Record<Option, string>>;
  // The group's own accessible name (F3 fix round 1, M4) — required, not
  // optional, so a caller can never ship a control VoiceOver reads with no
  // group context.
  accessibilityLabel: string;
  testID?: string;
};
