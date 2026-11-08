import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { holdingsRepo } from '@kiko/holdings/repo';
import { categoriesRepo } from '@kiko/categories/repo';
import { transactionsRepo } from '@kiko/transactions/repo';

/**
 * The rows the CSV is built from, and no more: no price points or rate history. The transactions
 * come from the read Statistics and the tables use (`listAllQuery`, every row, newest first), not
 * from the backup read ordered by id: rows of one time arrive in the app's own order, so the
 * transfer matcher pairs them as the app does.
 */
export const readCsvSnapshot = async () => ({
  accounts: await accountsRepo.listQuery(),
  holdings: await holdingsRepo.allQuery(),
  transactions: await transactionsRepo.listAllQuery(),
  categories: await categoriesRepo.allQuery(),
  settings: await settingsRepo.getQuery(),
});
