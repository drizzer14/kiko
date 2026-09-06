import type { TFunction } from 'react-i18next';

// The label shown for a transaction that carries no user-entered description.
// The sign of `amountMinorUnits` is the source of truth for direction: a
// non-negative movement reads as income, a negative one as expense (an expense
// is stored as the negative amount — see the domain schema). Both the Home list
// and the Holding-detail list render this same fallback so an empty description
// looks identical everywhere. Not a React component (a plain render-time
// helper the caller's own `useTranslation()` feeds `t` into), so it re-resolves
// against the active language on every call rather than freezing to a
// module-load-time language the way a bare English literal would.
export const defaultTransactionDescription = (
  holdingName: string,
  amountMinorUnits: number,
  t: TFunction,
): string => {
  const key =
    amountMinorUnits < 0
      ? 'transactions.defaultDescriptionExpense'
      : 'transactions.defaultDescriptionIncome';

  return t(key, { name: holdingName });
};
