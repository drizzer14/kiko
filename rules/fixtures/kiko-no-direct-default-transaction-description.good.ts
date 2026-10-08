import type { TFunction } from 'i18next';
import { transactionRowDescription } from '@kiko/transactions/row-description';

// Semgrep fixture (NEGATIVE): the surface resolves the blank-row label through
// its one owner, `transactionRowDescription`, which reaches the exchange-leg
// label and the holding-name default in the same order the lists do.
// `kiko-no-direct-default-transaction-description` MUST report nothing here.
export const placeholderFor = (
  holdingName: string,
  exchangeCounterpartHoldingId: string | null,
  holdingNameById: ReadonlyMap<string, string>,
  t: TFunction,
): string =>
  transactionRowDescription({
    transaction: { description: '', amountMinorUnits: -1, exchangeCounterpartHoldingId },
    holdingName,
    holdingNameById,
    t,
  });
