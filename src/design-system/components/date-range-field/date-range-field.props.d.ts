export type DateRangeFieldProps = {
  // The current inclusive range bounds; a null bound is open-ended on that side.
  // Both null means no active date filter — the field then displays the full
  // transaction span (minDate–maxDate) without filtering anything.
  dateFrom: Date | null;
  dateTo: Date | null;
  // The earliest and latest transaction dates, used only for the default display
  // span shown when no range is active. Always defined (today when there are no
  // transactions) so the field always has something to render.
  minDate: Date;
  maxDate: Date;
  // Commits the picked bounds when the user taps Apply in the modal.
  onApply: (from: Date | null, to: Date | null) => void;
  // Clears both bounds.
  onClear: () => void;
};
