import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';

export const isSyncedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source === 'monobank';

export const isSyncedHolding = (row: Pick<HoldingRow, 'metadata'>): boolean => {
  const meta = row.metadata;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'monobankId' in meta &&
    typeof (meta as { monobankId?: unknown }).monobankId === 'string'
  );
};

export const isSyncedAccount = (row: Pick<AccountRow, 'institution'>): boolean =>
  row.institution === 'monobank';
