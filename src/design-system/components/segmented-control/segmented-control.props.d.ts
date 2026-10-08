import type { TextVariant } from '../text';

export type SegmentedControlProps<Option extends string> = {
  options: readonly Option[];
  selected: Option;
  onSelect: (option: Option) => void;
  // Optional value -> display-text map. A segment whose value is an id-like
  // enum (`debitCredit`, `fixed`) shows human text while `onSelect` still
  // reports the underlying value. A value absent from the map renders
  // verbatim.
  labels?: Partial<Record<Option, string>>;
  // The segment label's `Text` variant, mirroring `ChipRow`'s own
  // `labelVariant`. Defaults to `'body'` — every existing consumer that
  // omits it is unchanged. A caller whose control sits directly under its
  // own larger section label (the Statistics trend-filter sheet's Top/Manual
  // mode toggle) passes `'caption'` so the control stays visually
  // subordinate to that label, the same hierarchy rule `ChipRow` follows.
  labelVariant?: TextVariant;
  // The group's own accessible name — required, not
  // optional, so a caller can never ship a control VoiceOver reads with no
  // group context.
  accessibilityLabel: string;
  testID?: string;
};
