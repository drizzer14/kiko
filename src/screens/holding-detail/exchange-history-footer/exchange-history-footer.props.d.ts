import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';

export type ExchangeHistoryFooterProps = {
  holding: Pick<HoldingRow, 'currency' | 'balanceMinorUnits' | 'metadata'>;
  // Undefined until the holding's account loads.
  account: Pick<AccountRow, 'institution'> | undefined;
  // Every row of the holding, as the ledger lists them.
  transactions: readonly Pick<TransactionRow, 'amountMinorUnits'>[];
};
