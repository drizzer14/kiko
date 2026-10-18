import { useEffect, useState } from 'react';
import { accountsRepo } from '@kiko/accounts';
import either, { bifoldr } from 'fnts/either';

/**
 * Whether the picks that decide how Save writes the account must stay locked, for a create form
 * that remounted from its own draft after a fold. The screen the fold replaced may still have
 * the insert of the pending row queued, which the live query shows only once it lands, and a
 * pick made before that would send Save down another path: a second account beside the row, or
 * its bank cleared. `exists` runs through the write queue, so its answer comes after that insert.
 * The lock lifts only on a "no row" answer: a stored row keeps it, and so does a failed read.
 */
export const usePendingRowLock = (accountId: string, isRemounted: boolean): boolean => {
  const [hasNoRow, setHasNoRow] = useState(false);

  useEffect(() => {
    if (!isRemounted) {
      return;
    }

    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
    either<unknown, boolean>(async () => accountsRepo.exists(accountId)).then((answer) => {
      if (bifoldr(answer) === false) {
        setHasNoRow(true);
      }
    });
  }, [accountId, isRemounted]);

  return isRemounted && !hasNoRow;
};
