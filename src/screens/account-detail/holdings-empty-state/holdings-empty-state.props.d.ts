export type HoldingsEmptyStateProps = {
  accountId: string;
  /** The account's institution, which names its exchange; unset while the row is missing. */
  institution: string | null | undefined;
  onAddHolding: () => void;
};
