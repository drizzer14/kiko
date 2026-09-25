import { Money } from '@kiko/currency/money';
import { useCallback, useState } from 'react';
import type { HoldingRow } from '@kiko/db/schema';
import { holdingsRepo } from '@kiko/holdings/repo';
import { parseAmount } from '@kiko/currency/parse';
import type { Currency } from '@kiko/currency/currency';

import { groupAmount, majorAmountText } from '../../../amount-format/amount-format';
import type { CreatePayload, EditContext, HoldingTypeForm } from '../../holding-type-form';

type UseBalanceFieldsParams = {
  currency: Currency;
};

export type UseBalanceFieldsResult = HoldingTypeForm & {
  currency: Currency;
  openingBalance: string;
  setOpeningBalance: (value: string) => void;
};

/**
 * Owns the balance form field shared by every ledgered type (card, cash,
 * crypto_asset, jar): a single opening-balance amount, with no per-field
 * validation of its own (`isValid` is unconditionally `true`, mirroring the
 * field's own always-optional/never-blocking behaviour today).
 * A synced (Monobank) holding's edit never writes its balance back (the sync
 * owns it) — see `saveEdit`'s own doc comment.
 */
export const useBalanceFields = (params: UseBalanceFieldsParams): UseBalanceFieldsResult => {
  const { currency } = params;

  const [openingBalance, setOpeningBalance] = useState('');

  const openingBalanceMinorUnits = (): number =>
    Money.fromMajor(currency, parseAmount(openingBalance) || 0).minorUnits;

  const seed = useCallback((holding: HoldingRow): void => {
    setOpeningBalance(groupAmount(majorAmountText(holding.currency, holding.balanceMinorUnits)));
  }, []);

  const createPayload = (): CreatePayload => ({
    balanceMinorUnits: openingBalanceMinorUnits(),
    metadata: undefined,
  });

  // A synced holding's balance is owned by the sync, not the user: the patch
  // omits `balanceMinorUnits` entirely so an edit never clobbers the last
  // synced balance. Every other holding writes its edited balance through
  // the ledger (`updateWithBalanceDelta`, not `update`), so its history
  // stays derivable from the ledger.
  const saveEdit = (context: EditContext): Promise<void> => {
    const { holdingId, name, color, isSynced } = context;
    const patch = isSynced
      ? { name, color }
      : { name, color, balanceMinorUnits: openingBalanceMinorUnits() };

    return holdingsRepo.updateWithBalanceDelta(holdingId, patch, Date.now());
  };

  return {
    currency,
    openingBalance,
    setOpeningBalance,
    isValid: true,
    scrollTargets: [],
    createPayload,
    saveEdit,
    seed,
  };
};
