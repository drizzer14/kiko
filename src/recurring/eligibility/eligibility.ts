import {
  accountKindByHoldingIdOf,
  ledgerRowsOf,
  ownIbansOf,
} from '@kiko/statistics/spending-ledger';
import {
  descriptionExcludedTransferTransactionIds,
  mccExcludedTransferTransactionIds,
} from '@kiko/statistics/transfer-exclusion';
import {
  internalTransferTransactionIds,
  rowsForTransferMatch,
} from '@kiko/statistics/internal-transfers';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';
import { exchangeFundingMatches } from '@kiko/statistics/exchange-funding-match';

type EligibilityRow = Pick<
  TransactionRow,
  | 'id'
  | 'holdingId'
  | 'amountMinorUnits'
  | 'time'
  | 'description'
  | 'mcc'
  | 'counterIban'
  | 'categorySetByHand'
  | 'setsBalance'
  | 'changeGroupId'
  | 'exchangePairId'
  | 'exchangeCounterpartHoldingId'
  | 'untrackedCounterpart'
  | 'loanHoldingId'
>;
type EligibilityHolding = Pick<HoldingRow, 'id' | 'accountId' | 'currency' | 'metadata'>;
type EligibilityAccount = Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>;

const CHARGE_ACCOUNT_KINDS: readonly AccountRow['kind'][] = ['bank', 'cash'];

/**
 * The ids the whole-ledger matchers drop: a matched own transfer, a cash-out or own-card
 * transfer, the internal wording, and a debit that funded an exchange purchase.
 */
export const recurringExcludedIds = (
  rows: readonly EligibilityRow[],
  holdings: readonly EligibilityHolding[],
  accounts: readonly EligibilityAccount[],
): ReadonlySet<string> => {
  const ledger = ledgerRowsOf(rows, holdings);

  return new Set([
    ...internalTransferTransactionIds(rowsForTransferMatch(ledger)),
    ...mccExcludedTransferTransactionIds(ledger, ownIbansOf(holdings)),
    ...descriptionExcludedTransferTransactionIds(ledger),
    ...exchangeFundingMatches(ledger, accountKindByHoldingIdOf(accounts, holdings)).excludedIds,
  ]);
};

/** The structural part of what makes a row a charge; `recurringExcludedIds` covers the rest. */
export const isRecurringCandidate = (
  row: EligibilityRow,
  holding: EligibilityHolding | undefined,
  account: EligibilityAccount | undefined,
): boolean => {
  if (holding === undefined || account === undefined) {
    return false;
  }

  return (
    row.amountMinorUnits < 0 &&
    row.description.trim() !== '' &&
    !row.setsBalance &&
    row.changeGroupId === null &&
    row.loanHoldingId === null &&
    // The matcher keeps exactly the rows with none of the three exchange markers.
    rowsForTransferMatch([row]).length === 1 &&
    CHARGE_ACCOUNT_KINDS.includes(account.kind) &&
    account.archivedAt === null
  );
};
