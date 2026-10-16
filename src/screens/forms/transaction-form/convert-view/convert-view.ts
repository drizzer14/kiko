import {
  canConvertToExchange,
  type ExchangeConvertDirection,
  exchangeConvertDirection,
} from '@kiko/holdings/exchange-convert';
import type { TFunction } from 'i18next';
import {
  isExchangeDestinationType,
  isExchangeSourceType,
} from '@kiko/holdings/exchange-destination';
import type { Currency } from '@kiko/currency/currency';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import { toAmountFields } from '../hydration';
import { buildExchangeOptions, syncedHoldingIds } from '../holding-options';

// Convert-mode's derived view: eligibility, direction, the counterpart picker
// options, the read-only fixed side's display value, and the direction-
// dependent labels — bundled into one object so the component body spends a
// single call on all of it, rather than an eligibility `&&` chain plus a
// direction ternary plus a labels ternary each adding their own cognitive-
// complexity cost. Kept module-level and pure (given the loaded `existing`
// row, `holding`, and `holdings`) for the same budget reason as
// `buildExchangeOptions` (see `holding-options`).
export type ConvertView = {
  eligible: boolean;
  direction: ExchangeConvertDirection | null;
  options: HoldingSelectOption[];
  fixedValue: string;
  fixedLabel: string;
  counterpartLabel: string;
  counterpartSheetTitle: string;
  counterpartAmountLabel: string;
};

// The holding types the convert counterpart picker lists: an expense-sourced
// convert picks a DESTINATION (wider: excludes bond/jar), an income-sourced one
// picks a SOURCE (wider: cash/card only).
export const convertCounterpartType = (
  direction: ExchangeConvertDirection | null,
): ((type: HoldingRow['type']) => boolean) =>
  direction === 'record-source' ? isExchangeSourceType : isExchangeDestinationType;

export const resolveConvertView = (
  existing: Pick<TransactionRow, 'amountMinorUnits'> | undefined,
  isEditing: boolean,
  holding: Pick<HoldingRow, 'type'> | undefined,
  currency: Currency,
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  accountById: ReadonlyMap<string, AccountRow>,
  holdingId: string | undefined,
  t: TFunction,
): ConvertView => {
  // Convert-mode eligibility uses the WIDER (cash/card) rule, unchanged from
  // the current create source rule — the create-only cash-source restriction
  // applies to CREATE only. Both manual and synced rows qualify; the action
  // gives the existing row only the pair id (plus the marker when it is manual
  // or imported), so a synced row stays safe.
  const eligible =
    isEditing &&
    existing !== undefined &&
    holding !== undefined &&
    canConvertToExchange(holding.type, existing.amountMinorUnits);
  const direction = existing ? exchangeConvertDirection(existing.amountMinorUnits) : null;
  // The counterpart picker's types are `convertCounterpartType`'s. Excludes
  // the existing holding, closed holdings, and a synced/syncable holding —
  // the counterpart is a NEW manual leg `save` writes, and a sync already
  // owns that holding's balance — and carries account names.
  const syncableIds = syncedHoldingIds(holdings, accountById);
  const options = buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    holdingId,
    convertCounterpartType(direction),
  ).filter((option) => !syncableIds.has(option.id));
  // The fixed side's display value: the existing amount in the existing
  // holding's currency, formatted the same way the Amount input shows it.
  const fixedValue = existing
    ? groupAmount(toAmountFields(currency, existing.amountMinorUnits).amount)
    : '';
  // Expense source -> fixed side is Value Out, the user records a destination
  // (To/Value In). Income destination -> fixed side is Value In, the user
  // records a source (From/Value Out).
  const labels =
    direction === 'record-source'
      ? {
          fixedLabel: t('forms.transaction.valueIn'),
          counterpartLabel: t('forms.transaction.from'),
          counterpartSheetTitle: t('forms.transaction.fromSheetTitle'),
          counterpartAmountLabel: t('forms.transaction.valueOut'),
        }
      : {
          fixedLabel: t('forms.transaction.valueOut'),
          counterpartLabel: t('forms.transaction.to'),
          counterpartSheetTitle: t('forms.transaction.toSheetTitle'),
          counterpartAmountLabel: t('forms.transaction.valueIn'),
        };

  return { eligible, direction, options, fixedValue, ...labels };
};
