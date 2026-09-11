import { isExchangeSourceType } from '../exchange-destination';
import type { HoldingType } from '../holding-type';

// Which leg the user records when converting an existing transaction into an
// Exchange, chosen by the sign of the existing amount (spec "Direction, by the
// sign of the existing transaction"):
//   - an existing EXPENSE (amount < 0) is the SOURCE leg, so the user records
//     the missing DESTINATION (receipt) leg -> 'record-destination';
//   - an existing INCOME (amount > 0) is the DESTINATION leg, so the user
//     records the missing SOURCE (payment) leg -> 'record-source'.
export type ExchangeConvertDirection = 'record-destination' | 'record-source';

// A transaction is convertible when its holding is liquid (cash/card — the same
// wider source eligibility create-mode uses, kept for convert-mode by design)
// AND its amount is non-zero (a zero has no sign to pick a direction from).
// Applies to BOTH manual and synced rows — the caller does not gate on `source`.
export const canConvertToExchange = (holdingType: HoldingType, amountMinorUnits: number): boolean =>
  isExchangeSourceType(holdingType) && amountMinorUnits !== 0;

export const exchangeConvertDirection = (
  amountMinorUnits: number,
): ExchangeConvertDirection | null => {
  if (amountMinorUnits < 0) {
    return 'record-destination';
  }

  if (amountMinorUnits > 0) {
    return 'record-source';
  }

  return null;
};
