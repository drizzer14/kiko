export type TimeFieldProps = {
  // The caption rendered above the field, and the field's accessibility label.
  label: string;
  // The current transaction time as a unix-millis timestamp; the field displays
  // its time-of-day (HH:mm). Null when there is nothing to show yet.
  value: number | null;
  // Reports the new timestamp: the picked hours/minutes combined with the DAY
  // (year/month/date) of the current `value`, so a time pick never moves the day.
  onChange: (timestamp: number) => void;
  // Shown in the field when `value` is null.
  placeholder?: string;
  // When true, the field is read-only: a press is inert (the picker never opens)
  // and the field is dimmed to read as locked — matching the disabled DateField /
  // TextField treatment. A synced (Monobank) transaction's time uses this so its
  // bank-owned time cannot be changed.
  disabled?: boolean;
  // An optional testID applied to the field's Pressable trigger, so a flow can
  // open the picker sheet deterministically.
  testID?: string;
  // An optional testID applied to the sheet's dismiss backdrop, so a flow can
  // close the sheet by tapping the scrim (the sheet is a full-screen Modal).
  backdropTestID?: string;
};
