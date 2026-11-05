import { useMemo } from 'react';

import {
  descriptionExcludedTransferTransactionIds,
  mccExcludedTransferTransactionIds,
} from '../transfer-exclusion';
import {
  exchangeExcludedTransactionIds,
  sameCurrencyMoveTransactionIds,
} from '../exchange-exclusion';
import { exchangeFundingMatches } from '../exchange-funding-match';
import { loanInterestEntries, loanPaymentExcludedTransactionIds } from '../loan-payments';
import { internalTransferTransactionIds, rowsForTransferMatch } from '../internal-transfers';

import {
  accountKindByHoldingIdOf,
  balanceSetIdsOf,
  breakdownRowsOf,
  excludedIdsOf,
  ledgerRowsOf,
  loanHoldingsOf,
  ownIbansOf,
  shownRowsOf,
  trendRowsOf,
  type SpendingLedger,
  type SpendingLedgerInput,
} from './spending-ledger';

/**
 * `buildSpendingLedger` as memos: one per part, each keyed on the inputs it reads, so an account
 * toggle (which changes only `shownHoldings`) never reruns a ledger-wide matcher.
 */
export const useSpendingLedger = (input: SpendingLedgerInput): SpendingLedger => {
  const { transactions, holdings, accounts, shownHoldings } = input;

  const ledgerWithCurrency = useMemo(
    () => ledgerRowsOf(transactions, holdings),
    [transactions, holdings],
  );

  const shownRows = useMemo(
    () => shownRowsOf(ledgerWithCurrency, shownHoldings),
    [ledgerWithCurrency, shownHoldings],
  );

  // The matcher sees only unmarked rows: an exchange leg is excluded by its marker, or by the pair
  // rule when it is an equal same-currency pair on two holdings, and must never pair with (and so
  // swallow) an unmarked Pay send.
  const internalTransferIds = useMemo(
    () => internalTransferTransactionIds(rowsForTransferMatch(ledgerWithCurrency)),
    [ledgerWithCurrency],
  );

  const loanHoldings = useMemo(() => loanHoldingsOf(holdings), [holdings]);

  // A linked payment never counts its PRINCIPAL as spending, only its interest and any
  // within-tolerance fee (`loanInterestEntries`, via `loanInterestRows` below, which replaces each
  // excluded row with its own derived entries) — computed over the account-filtered rows, because
  // a payment and its interest entry belong to the payment's own holding; only `loanHoldings`
  // above reads every holding.
  const loanPaymentExcludedIds = useMemo(
    () => loanPaymentExcludedTransactionIds(shownRows, loanHoldings),
    [shownRows, loanHoldings],
  );

  const loanInterestRows = useMemo(
    () => loanInterestEntries({ transactions: shownRows, loanHoldings }),
    [shownRows, loanHoldings],
  );

  const breakdownTransactions = useMemo(() => breakdownRowsOf(shownRows), [shownRows]);

  const trendTransactions = useMemo(
    () => trendRowsOf(shownRows, loanInterestRows),
    [shownRows, loanInterestRows],
  );

  const ownIbans = useMemo(() => ownIbansOf(holdings), [holdings]);

  // Cash-outs and OWN-account transfers, classified by mcc (+ counterIban for the ambiguous
  // 4829). This catches the single-legged movements the matched-pair matcher structurally cannot
  // (a cash-out has no synced credit leg).
  const mccExcludedIds = useMemo(
    () => mccExcludedTransferTransactionIds(breakdownTransactions, ownIbans),
    [breakdownTransactions, ownIbans],
  );

  // Internal transfers that carry a plain description instead of a transfer MCC (e.g. "Поповнення
  // депозиту", "На чорну картку", the FOP top-up). The mcc rule structurally cannot see these; the
  // description rule catches them.
  const descriptionExcludedIds = useMemo(
    () => descriptionExcludedTransferTransactionIds(breakdownTransactions),
    [breakdownTransactions],
  );

  // Exchange/Convert legs: an internal movement between the user's own holdings, structurally
  // marked by `exchangeCounterpartHoldingId`. No other rule can see them — null mcc, empty
  // description, and a cross-currency pair the matched-pair matcher rejects.
  const exchangeExcludedIds = useMemo(
    () => exchangeExcludedTransactionIds(breakdownTransactions),
    [breakdownTransactions],
  );

  // The synced debit a Convert marked with the pair id only has no marker for the rule above, and
  // the matcher never sees a row with a pair id. Over the unfiltered ledger, so a partner under an
  // account the filter hides still pairs.
  const sameCurrencyMoveIds = useMemo(
    () => sameCurrencyMoveTransactionIds(ledgerWithCurrency),
    [ledgerWithCurrency],
  );

  const accountKindByHoldingId = useMemo(
    () => accountKindByHoldingIdOf(accounts, holdings),
    [accounts, holdings],
  );

  // The bank debits that paid for an exchange purchase (a P2P buy, a card buy or a fiat deposit)
  // are not spending: the purchase is not the money leaving. Over the unfiltered ledger, never the
  // account-filtered rows, because the exchange row sits under a crypto account the filter may
  // hide, and the debit would then count again.
  const exchangeFundingExcludedIds = useMemo(
    () => exchangeFundingMatches(ledgerWithCurrency, accountKindByHoldingId).excludedIds,
    [ledgerWithCurrency, accountKindByHoldingId],
  );

  const balanceSetIds = useMemo(() => balanceSetIdsOf(ledgerWithCurrency), [ledgerWithCurrency]);

  const excludedTransactionIds = useMemo(
    () =>
      excludedIdsOf({
        internalTransferIds,
        mccExcludedIds,
        descriptionExcludedIds,
        exchangeExcludedIds,
        sameCurrencyMoveIds,
        exchangeFundingExcludedIds,
        loanPaymentExcludedIds,
        balanceSetIds,
      }),
    [
      internalTransferIds,
      mccExcludedIds,
      descriptionExcludedIds,
      exchangeExcludedIds,
      sameCurrencyMoveIds,
      exchangeFundingExcludedIds,
      loanPaymentExcludedIds,
      balanceSetIds,
    ],
  );

  return useMemo(
    () => ({
      ledgerWithCurrency,
      shownRows,
      breakdownTransactions,
      trendTransactions,
      excludedTransactionIds,
    }),
    [
      ledgerWithCurrency,
      shownRows,
      breakdownTransactions,
      trendTransactions,
      excludedTransactionIds,
    ],
  );
};
