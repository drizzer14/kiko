import { useMemo } from 'react';
import {
  type RecurringInput,
  chargeGroupsOf,
  foldTwins,
  groupKeyOf,
} from '@kiko/recurring/detection';
import { startOfLocalDay } from '@kiko/dates';
import { settingsRepo } from '@kiko/settings';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type TransactionRow, useLiveQuery } from '@kiko/db';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { markedChainOfAmount } from '@kiko/recurring/marked-series';

type RowMark = {
  chain: ReturnType<typeof markedChainOfAmount>;
  isReady: boolean;
};

type Read = { isLoading: boolean; error?: Error };

// A read turned off keeps the `error` it last held, so only an enabled read can hold the field.
const isSettled = (read: Read, isEnabled: boolean): boolean =>
  !isEnabled || (!read.isLoading && read.error === undefined);

/**
 * The marked chain a stored debit sits in, for the transaction form's mark field. The settings
 * read runs only for a row the form offers; the whole-ledger read runs only under a name marked in
 * this currency, so a row under an unmarked name costs what it did. The ledger read lands after the
 * settings one, so `isReady` is false until both have settled, and a rejected read holds it false
 * until a later good fire: the field must not read "Not marked" on rows it never got.
 */
export const useRowMark = (
  row: Pick<TransactionRow, 'amountMinorUnits' | 'description'>,
  currency: Currency,
  isOffered: boolean,
  holdings: RecurringInput['holdings'],
  accounts: RecurringInput['accounts'],
): RowMark => {
  const key = merchantNameOf(row.description).key;
  const settings = useLiveQuery(
    settingsRepo.recurringMerchantChoicesQuery(),
    ['settings'],
    isOffered,
  );
  const marks = useMemo(
    () =>
      settingsRepo
        .recurringMerchantChoicesOf(settings.data.at(0)?.recurringMerchantChoices)
        .get(key)?.marks ?? [],
    [settings.data, key],
  );
  const readsLedger = marks.some((mark) => mark.currency === currency);
  const ledger = useLiveQuery(
    transactionsRepo.recurringLedgerQuery(),
    ['transactions'],
    readsLedger,
  );
  const today = startOfLocalDay(Date.now());
  const groups = useMemo(
    () =>
      readsLedger && !ledger.isLoading
        ? chargeGroupsOf({ rows: ledger.data, holdings, accounts }, today)
        : undefined,
    [readsLedger, ledger.isLoading, ledger.data, holdings, accounts, today],
  );
  const chain = useMemo(
    () =>
      markedChainOfAmount(
        foldTwins(groups?.groups.get(groupKeyOf(key, currency))?.charges ?? []).map(
          ({ amount }) => ({ amountMinorUnits: amount }),
        ),
        marks,
        Math.abs(row.amountMinorUnits),
        currency,
      ),
    [groups, key, currency, marks, row.amountMinorUnits],
  );

  return { chain, isReady: isSettled(settings, isOffered) && isSettled(ledger, readsLedger) };
};
