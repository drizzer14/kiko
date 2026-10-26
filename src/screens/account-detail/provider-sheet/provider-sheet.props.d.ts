export type ProviderSheetEntry<Id extends string> = {
  id: Id;
  /** The row's title line. */
  label: string;
  /** The caption lines under the label, in order. */
  captions: string[];
  accessibilityLabel: string;
};

export type ProviderSheetProps<Id extends string> = {
  /** Whether the sheet and its dismiss scrim are mounted and shown. */
  visible: boolean;
  /** The sheet header, already translated. */
  title: string;
  /** The rows to offer, in display order. */
  entries: ProviderSheetEntry<Id>[];
  /** Called on a tap on the scrim behind the sheet, or a hardware/gesture back. */
  onDismiss: () => void;
  /** Called with the chosen entry's id; the sheet closes itself after. */
  onSelect: (id: Id) => void;
  /** Test ids: `<prefix>-sheet` on the sheet, `<prefix>-option-<id>` on each row. */
  testIDPrefix: string;
};
