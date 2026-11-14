import { useMemo } from 'react';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type AccountRow, type HoldingRow, type TransactionRow, useLiveQuery } from '@kiko/db';

import { exchangeFundingMatches, type FundingKind } from '../exchange-funding-match';

export type FundingCaptionKey =
  | 'transactions.matchedP2pPurchase'
  | 'transactions.matchedCardPurchase'
  | 'transactions.matchedExchangeDeposit';

const captionKeyOf = (kind: FundingKind): FundingCaptionKey =>
  match(kind)
    .returnType<FundingCaptionKey>()
    .with('p2p', () => 'transactions.matchedP2pPurchase')
    .with('card', () => 'transactions.matchedCardPurchase')
    .with('bank', () => 'transactions.matchedExchangeDeposit')
    .exhaustive();

// The same join the statistics screen feeds the matcher: a transaction row carries no currency of
// its own, so each row takes its holding's, and a row whose holding is gone is left out.
const fundingLedgerOf = (
  transactions: readonly Pick<
    TransactionRow,
    | 'id'
    | 'holdingId'
    | 'time'
    | 'amountMinorUnits'
    | 'untrackedCounterpart'
    | 'description'
    | 'mcc'
    | 'categorySetByHand'
    | 'setsBalance'
  >[],
  holdings: readonly HoldingRow[],
) => {
  const currencyByHoldingId = new Map(holdings.map(({ id, currency }) => [id, currency]));

  return transactions.flatMap(
    (transaction) =>
      foldMap(maybe(currencyByHoldingId.get(transaction.holdingId)), (currency) => [
        { ...transaction, currency },
      ]) ?? [],
  );
};

// A holding whose account is not in the list is left out of the map, and the matcher counts such a
// holding as a bank side.
const accountKindByHoldingIdOf = (
  holdings: readonly HoldingRow[],
  accounts: readonly AccountRow[],
): Map<string, AccountRow['kind']> => {
  const kindByAccountId = new Map(accounts.map(({ id, kind }) => [id, kind]));

  return new Map(
    holdings.flatMap(
      ({ id, accountId }) =>
        foldMap(maybe(kindByAccountId.get(accountId)), (kind) => [[id, kind] as const]) ?? [],
    ),
  );
};

/**
 * The copy key of the caption a bank debit shows when the funding matcher pairs it with an
 * exchange purchase and the statistics screen therefore leaves it out of spending, or `undefined`
 * for any other row. It runs the matcher over the rows of the debit's own bucket only, not the
 * whole ledger the screen reads, and the two never disagree: a pair forms only between a debit and
 * a purchase of one (fiat, total) bucket, and the matcher's order and augmenting paths never leave
 * a bucket, so a row's match is the same over the bucket as over the whole ledger. A debit the user
 * categorized by hand stays in spending and gets no caption.
 *
 * Nothing is read for a credit. The holdings and accounts come first because only they say whether
 * the row sits on a crypto account, and a crypto row never reads the ledger.
 */
export const useExchangeFundingCaption = (
  transaction: Pick<TransactionRow, 'id' | 'holdingId' | 'amountMinorUnits'> | undefined,
): FundingCaptionKey | undefined => {
  const isDebit = transaction !== undefined && transaction.amountMinorUnits < 0;
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.allQuery(),
    ['holdings'],
    isDebit,
  );
  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(
    accountsRepo.listQuery(),
    ['accounts'],
    isDebit,
  );
  const accountKindByHoldingId = useMemo(
    () => accountKindByHoldingIdOf(holdings, accounts),
    [holdings, accounts],
  );
  const isOnCryptoHolding =
    transaction !== undefined && accountKindByHoldingId.get(transaction.holdingId) === 'crypto';
  const readsLedger = isDebit && !(holdingsLoading || accountsLoading || isOnCryptoHolding);
  const { data: transactions } = useLiveQuery(
    transactionsRepo.fundingMatchCandidatesQuery(transaction?.amountMinorUnits ?? 0),
    ['transactions'],
    readsLedger,
  );
  const transactionId = transaction?.id;

  return useMemo(() => {
    if (!readsLedger || transactionId === undefined) {
      return undefined;
    }

    const { matches, excludedIds } = exchangeFundingMatches(
      fundingLedgerOf(transactions, holdings),
      accountKindByHoldingId,
    );
    const funding = excludedIds.has(transactionId) ? matches.get(transactionId) : undefined;

    return foldMap(maybe(funding), ({ kind }) => captionKeyOf(kind));
  }, [readsLedger, transactionId, transactions, holdings, accountKindByHoldingId]);
};
