import maybe, { foldMap } from 'fnts/maybe';
import {
  descriptionExcludedTransferTransactionIds,
  mccExcludedTransferTransactionIds,
} from '@kiko/statistics/transfer-exclusion';
import {
  internalTransferTransactionIds,
  rowsForTransferMatch,
} from '@kiko/statistics/internal-transfers';
import { ibanOf } from '@kiko/holdings/holding-metadata';
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

// A row with no holding has no currency, so the matchers never see it, as in the spending ledger.
const ledgerOf = (rows: readonly EligibilityRow[], holdings: readonly EligibilityHolding[]) => {
  const currencyByHoldingId = new Map(holdings.map(({ id, currency }) => [id, currency]));

  return rows.flatMap(
    (row) =>
      foldMap(maybe(currencyByHoldingId.get(row.holdingId)), (currency) => [
        { ...row, currency },
      ]) ?? [],
  );
};

const ownIbansOf = (holdings: readonly EligibilityHolding[]): ReadonlySet<string> =>
  new Set(
    holdings.flatMap(({ metadata }) => foldMap(maybe(ibanOf(metadata)), (iban) => [iban]) ?? []),
  );

// A holding whose account is missing is left out, which the funding matcher reads as a bank side.
const accountKindByHoldingIdOf = (
  holdings: readonly EligibilityHolding[],
  accounts: readonly EligibilityAccount[],
): ReadonlyMap<string, AccountRow['kind']> => {
  const kindByAccountId = new Map(accounts.map(({ id, kind }) => [id, kind]));

  return new Map(
    holdings.flatMap(
      ({ id, accountId }) =>
        foldMap(maybe(kindByAccountId.get(accountId)), (kind) => [[id, kind] as const]) ?? [],
    ),
  );
};

/**
 * The ids the whole-ledger matchers drop: a matched own transfer, a cash-out or own-card
 * transfer, the internal wording, and a debit that funded an exchange purchase.
 */
export const recurringExcludedIds = (
  rows: readonly EligibilityRow[],
  holdings: readonly EligibilityHolding[],
  accounts: readonly EligibilityAccount[],
): ReadonlySet<string> => {
  const ledger = ledgerOf(rows, holdings);

  return new Set([
    ...internalTransferTransactionIds(rowsForTransferMatch(ledger)),
    ...mccExcludedTransferTransactionIds(ledger, ownIbansOf(holdings)),
    ...descriptionExcludedTransferTransactionIds(ledger),
    ...exchangeFundingMatches(ledger, accountKindByHoldingIdOf(holdings, accounts)).excludedIds,
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
