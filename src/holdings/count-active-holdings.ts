import { activeHoldings } from '../rates/active-holdings';
import { accountsRepo } from '../repositories/accounts.repo';
import { holdingsRepo } from '../repositories/holdings.repo';

/**
 * The count of active holdings the user sees — an open holding (`closedAt` null)
 * under a non-archived account, the same set net worth uses. It is the
 * determinate sync-progress bar's denominator, shared by the Monobank and crypto
 * sync default deps so both paths agree on the whole-app total (see the progress
 * session in `src/monobank/sync-status.ts`).
 */
export const countActiveHoldings = async (): Promise<number> => {
  const [holdingsList, accountsList] = await Promise.all([
    holdingsRepo.allQuery(),
    accountsRepo.listQuery(),
  ]);
  return activeHoldings(holdingsList, accountsList).length;
};
