import { transactionsRepo } from '@kiko/transactions/repo';

import { readDataSnapshot } from '../snapshot/read-snapshot';

/**
 * The rows the CSV is built from. The transactions come from the read Statistics and the tables
 * use (`listAllQuery`, every row, newest first), not from the backup read ordered by id: rows of
 * one time arrive in the app's own order, so the transfer matcher pairs them as the app does.
 */
export const readCsvSnapshot = async () => ({
  ...(await readDataSnapshot()),
  transactions: await transactionsRepo.listAllQuery(),
});
