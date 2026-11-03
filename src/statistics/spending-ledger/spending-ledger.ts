import maybe, { foldMap } from 'fnts/maybe';
import { ibanOf } from '@kiko/holdings/holding-metadata';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';
import { holdingDescriptorOrUndefined } from '@kiko/holdings/holding-descriptor';

import {
  descriptionExcludedTransferTransactionIds,
  mccExcludedTransferTransactionIds,
} from '../transfer-exclusion';
import {
  exchangeExcludedTransactionIds,
  sameCurrencyMoveTransactionIds,
} from '../exchange-exclusion';
import type { TrendTransaction } from '../category-trend';
import type { BreakdownTransaction } from '../category-breakdown';
import { exchangeFundingMatches } from '../exchange-funding-match';
import { loanInterestEntries, loanPaymentExcludedTransactionIds } from '../loan-payments';
import { internalTransferTransactionIds, rowsForTransferMatch } from '../internal-transfers';

/** A transaction joined to its holding for the currency its amount is in. */
export type LedgerRow = TransactionRow & { currency: HoldingRow['currency'] };

export type SpendingLedgerInput = {
  transactions: readonly TransactionRow[];
  holdings: readonly HoldingRow[];
  accounts: readonly AccountRow[];
  /** The holdings the spending charts draw: under the kept accounts, open or closed. */
  shownHoldings: readonly HoldingRow[];
};

export type SpendingLedger = {
  /** Both signs, every holding. */
  ledgerWithCurrency: LedgerRow[];
  /** The rows the spending charts draw. */
  shownRows: LedgerRow[];
  breakdownTransactions: BreakdownTransaction[];
  /** The shown rows plus the derived loan entries, each with its time. */
  trendTransactions: TrendTransaction[];
  excludedTransactionIds: ReadonlySet<string>;
};

/**
 * Every exclusion rule's ids. A key is required for each rule, so a rule added here is a compile
 * error in every caller that builds the parts, never a set only one of them knows about.
 */
type ExclusionParts = {
  internalTransferIds: ReadonlySet<string>;
  mccExcludedIds: ReadonlySet<string>;
  descriptionExcludedIds: ReadonlySet<string>;
  exchangeExcludedIds: ReadonlySet<string>;
  sameCurrencyMoveIds: ReadonlySet<string>;
  exchangeFundingExcludedIds: ReadonlySet<string>;
  loanPaymentExcludedIds: ReadonlySet<string>;
  balanceSetIds: ReadonlySet<string>;
};

/**
 * The union of every exclusion rule: the mcc/IBAN rule, the description rule, the exchange-marker
 * rule, the same-currency pair rule, the cheap secondary matched-pair matcher, the
 * exchange-funding matcher, the linked-loan-payment rule (its own derived interest and
 * within-tolerance fee entries replace the raw row this drops) and the balance-set mark. A row is
 * dropped from the spending pie if ANY rule catches it.
 */
export const excludedIdsOf = (parts: ExclusionParts): ReadonlySet<string> =>
  new Set([
    ...parts.internalTransferIds,
    ...parts.mccExcludedIds,
    ...parts.descriptionExcludedIds,
    ...parts.exchangeExcludedIds,
    ...parts.sameCurrencyMoveIds,
    ...parts.exchangeFundingExcludedIds,
    ...parts.loanPaymentExcludedIds,
    ...parts.balanceSetIds,
  ]);

/**
 * The rows whose amount set a balance (an opening balance, a cash opening, a hand edit). The
 * amount is the balance being stated, not money spent, so it never counts. The mark is stored
 * for good, so a row later given a category or a description stays out, and the rows an old
 * migration or a `.kiko` restore marked are caught the same way. A row of any holding counts,
 * whatever the account filter.
 */
export const balanceSetIdsOf = (ledger: readonly LedgerRow[]): Set<string> =>
  new Set(ledger.filter((transaction) => transaction.setsBalance).map(({ id }) => id));

/**
 * Join each transaction to its holding for the currency its amount is in — a transaction row has
 * no currency of its own. BOTH signs are kept so the internal-transfer matcher can see the credit
 * legs.
 *
 * Every holding counts here, whatever its account filter or `closedAt`: the other leg of a
 * transfer can sit under a filtered-out account or in a jar a sync has since closed, and losing
 * it turns the debit leg into spending.
 *
 * Deliberately NOT range-filtered: every exclusion rule (the matched-pair internal-transfer
 * matcher especially) must see BOTH legs of a transfer even when only one falls inside the
 * active range, or a pair that straddles the range edges gets only half-excluded and its
 * in-range leg wrongly counts as spending. The range is applied only to the rows that actually
 * feed the breakdown (`spendingRowsIn`) — exclusion is by id, so an out-of-range leg excluded
 * here never reaches the breakdown anyway.
 */
export const ledgerRowsOf = (
  transactions: readonly TransactionRow[],
  holdings: readonly HoldingRow[],
): LedgerRow[] => {
  const currencyByHolding = new Map(holdings.map((holding) => [holding.id, holding.currency]));

  return transactions.flatMap((transaction) => {
    const currency = currencyByHolding.get(transaction.holdingId);

    if (currency === undefined) {
      return [];
    }

    return [{ ...transaction, currency }];
  });
};

/**
 * The rows the spending charts draw: the account filter applies, but not `closedAt`, so a closed
 * card keeps its past spending.
 */
export const shownRowsOf = (
  ledger: readonly LedgerRow[],
  shownHoldings: readonly HoldingRow[],
): LedgerRow[] => {
  const shownHoldingIds = new Set(shownHoldings.map((holding) => holding.id));

  return ledger.filter((transaction) => shownHoldingIds.has(transaction.holdingId));
};

/**
 * Every DEBT-side holding in the raw, unfiltered ledger (only `loan` today): a payment's linked
 * loan can live under an account filtered out of the other charts, and a closed/paid-off loan
 * still EXISTS (only a delete clears its links), so neither should change whether its payment's
 * interest counts.
 */
export const loanHoldingsOf = (holdings: readonly HoldingRow[]): HoldingRow[] =>
  holdings.filter((holding) => holdingDescriptorOrUndefined(holding.type)?.side === 'debt');

/**
 * The user's OWN card IBANs, read from each holding's stored metadata. A 4829 bank transfer to
 * one of these is an own-account transfer (excluded from the spending pie); a 4829 to any other
 * IBAN is a genuine P2P payment (kept).
 */
export const ownIbansOf = (holdings: readonly HoldingRow[]): Set<string> => {
  const ibans = new Set<string>();

  for (const holding of holdings) {
    const iban = ibanOf(holding.metadata);

    if (iban !== undefined) {
      ibans.add(iban);
    }
  }

  return ibans;
};

/**
 * The account kind of each holding, so the funding matcher can tell a crypto account's own rows
 * from the bank rows that paid for them. A holding whose account is not in the list is left out
 * of the map, and the matcher counts such a holding as a bank side.
 */
export const accountKindByHoldingIdOf = (
  accounts: readonly AccountRow[],
  holdings: readonly HoldingRow[],
): Map<string, AccountRow['kind']> => {
  const kindByAccountId = new Map(accounts.map((account) => [account.id, account.kind]));

  return new Map(
    holdings.flatMap(
      (holding) =>
        foldMap(maybe(kindByAccountId.get(holding.accountId)), (kind) => [
          [holding.id, kind] as const,
        ]) ?? [],
    ),
  );
};

const toBreakdownRow = (transaction: LedgerRow): BreakdownTransaction => ({
  id: transaction.id,
  category: transaction.category,
  amountMinorUnits: transaction.amountMinorUnits,
  mcc: transaction.mcc,
  counterIban: transaction.counterIban,
  description: transaction.description,
  exchangeCounterpartHoldingId: transaction.exchangeCounterpartHoldingId,
  untrackedCounterpart: transaction.untrackedCounterpart,
  changeGroupId: transaction.changeGroupId,
  currency: transaction.currency,
});

export const breakdownRowsOf = (shownRows: readonly LedgerRow[]): BreakdownTransaction[] =>
  shownRows.map(toBreakdownRow);

/**
 * The spending-trend builder needs everything the breakdown does PLUS each row's `time`, so it
 * can bucket the expense into the active window the same way the net-worth line does. Built
 * separately from the breakdown rows (which carry no time) so neither has to change shape for
 * the other. The loan entries are appended UNFILTERED, same as the real rows: the trend builders
 * do their own range bucketing internally.
 */
export const trendRowsOf = (
  shownRows: readonly LedgerRow[],
  loanInterestRows: readonly TrendTransaction[],
): TrendTransaction[] => [
  ...shownRows.map((transaction) => ({ ...toBreakdownRow(transaction), time: transaction.time })),
  ...loanInterestRows,
];

/**
 * The shown rows inside `[from, to]` (both bounds inclusive), then the loan entries inside it.
 * This is what actually feeds the breakdown drawn on screen, so the donut and its center total
 * agree with the range field above them. The exclusion sets are not range-filtered; only the
 * rows actually SHOWN are scoped to the range here. The loan entries are range-filtered the SAME
 * way as the real rows: each derived entry replaces the raw row the loan-payment rule drops, so
 * it must obey the same window that row would have. The rows keep their `time`, which the
 * breakdown ignores.
 */
export const spendingRowsIn = (
  ledger: SpendingLedger,
  from: number,
  to: number,
): BreakdownTransaction[] =>
  ledger.trendTransactions.filter((entry) => entry.time >= from && entry.time <= to);

/**
 * The pure twin of `useSpendingLedger`: the same part functions in the same order, so a table
 * built off a ledger and the charts built off the hook cannot disagree.
 */
export const buildSpendingLedger = (input: SpendingLedgerInput): SpendingLedger => {
  const { transactions, holdings, accounts, shownHoldings } = input;
  const ledgerWithCurrency = ledgerRowsOf(transactions, holdings);
  const shownRows = shownRowsOf(ledgerWithCurrency, shownHoldings);
  const loanHoldings = loanHoldingsOf(holdings);
  const loanInterestRows = loanInterestEntries({ transactions: shownRows, loanHoldings });
  const breakdownTransactions = breakdownRowsOf(shownRows);
  const ownIbans = ownIbansOf(holdings);

  return {
    ledgerWithCurrency,
    shownRows,
    breakdownTransactions,
    trendTransactions: trendRowsOf(shownRows, loanInterestRows),
    excludedTransactionIds: excludedIdsOf({
      internalTransferIds: internalTransferTransactionIds(rowsForTransferMatch(ledgerWithCurrency)),
      mccExcludedIds: mccExcludedTransferTransactionIds(breakdownTransactions, ownIbans),
      descriptionExcludedIds: descriptionExcludedTransferTransactionIds(breakdownTransactions),
      exchangeExcludedIds: exchangeExcludedTransactionIds(breakdownTransactions),
      sameCurrencyMoveIds: sameCurrencyMoveTransactionIds(ledgerWithCurrency),
      exchangeFundingExcludedIds: exchangeFundingMatches(
        ledgerWithCurrency,
        accountKindByHoldingIdOf(accounts, holdings),
      ).excludedIds,
      loanPaymentExcludedIds: loanPaymentExcludedTransactionIds(shownRows, loanHoldings),
      balanceSetIds: balanceSetIdsOf(ledgerWithCurrency),
    }),
  };
};
