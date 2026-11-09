export type MccFieldProps = {
  /** The draft's code text: empty, half-typed, or four digits. */
  value: string;
  onChange: (mccText: string) => void;
  /** Shown under the typed field while typing, else under the trigger. */
  error: string | undefined;
  /** testID for the trigger, so a flow can open the sheet. */
  testID: string;
};
