import type { TFunction } from 'i18next';

// The label shown for a transaction that carries no user-entered description.
// The sign of `amountMinorUnits` is the source of truth for direction: a
// non-negative movement reads as income, a negative one as expense (an expense
// is stored as the negative amount — see the domain schema). Both the Home list
// and the Holding-detail list render this same fallback so an empty description
// looks identical everywhere. Not a React component (a plain render-time
// helper the caller's own `useTranslation()` feeds `t` into), so it re-resolves
// against the active language on every call rather than freezing to a
// module-load-time language the way a bare English literal would.
//
// An empty `holdingName` (F3 fix round 3, N9 — the statement-import preview,
// `ExampleTransaction`, before a target holding is chosen) falls back to the
// PLAIN label with no name at all, rather than interpolating an empty string
// into `defaultDescriptionExpense`/`Income` — that would leave a dangling
// leading space in English ("expense") or a dangling colon in Ukrainian
// ("Витрата: "). Every OTHER caller (Home, Holding detail) always passes a
// real holding name, so this branch is inert for them.
export const defaultTransactionDescription = (
  holdingName: string,
  amountMinorUnits: number,
  t: TFunction,
): string => {
  const isExpense = amountMinorUnits < 0;

  if (holdingName === '') {
    return t(
      isExpense
        ? 'transactions.defaultDescriptionExpensePlain'
        : 'transactions.defaultDescriptionIncomePlain',
    );
  }

  const key = isExpense
    ? 'transactions.defaultDescriptionExpense'
    : 'transactions.defaultDescriptionIncome';

  return t(key, { name: holdingName });
};
