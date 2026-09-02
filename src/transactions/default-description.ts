// The label shown for a transaction that carries no user-entered description.
// The sign of `amountMinorUnits` is the source of truth for direction: a
// non-negative movement reads as income, a negative one as expense (an expense
// is stored as the negative amount — see the domain schema). Both the Home list
// and the Holding-detail list render this same fallback so an empty description
// looks identical everywhere.
export const defaultTransactionDescription = (
  holdingName: string,
  amountMinorUnits: number,
): string => `${holdingName} ${amountMinorUnits < 0 ? 'expense' : 'income'}`;
