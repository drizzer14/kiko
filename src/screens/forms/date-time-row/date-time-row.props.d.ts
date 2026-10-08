export type DateTimeRowProps = {
  // The shared timestamp both fields read: a Date pick keeps the existing
  // time-of-day (DateField's own contract) and a Time pick keeps the existing
  // day (TimeField's own contract), so either field can move independently
  // through the SAME `onChangeTime` without clobbering the other.
  time: number;
  onChangeTime: (timestamp: number) => void;
  // The latest day the Date calendar offers (see DateField's `maxDate`).
  maxDate?: number;
  // Read-only (a synced/converted row's date and time cannot be edited).
  disabled?: boolean;
  // Turns both labels red. The caller renders the pair's one FieldError under
  // the row, since the date and the time together set the one instant it
  // judges.
  invalid?: boolean;
  // Optional testIDs applied to each field's own Pressable trigger, so a flow
  // can open either picker sheet deterministically.
  dateTestID?: string;
  timeTestID?: string;
};
