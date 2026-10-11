import type { AccountRow, HoldingRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import { isSyncedHolding } from '@kiko/holdings/deletable';
import { toHoldingOption } from '@kiko/screens/forms/holding-select-option';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

// Every holding whose account is currently sync-connected — its balance is
// sync-owned, so it can never be the target of a manual write. Shared by
// every holding picker on this screen that must exclude a synced/syncable
// holding (the return-row picker, the primary-leg picker, and Convert's own
// counterpart picker), so the exclusion rule can never drift between them.
export const syncedHoldingIds = (
  holdings: readonly HoldingRow[],
  accountById: ReadonlyMap<string, AccountRow>,
): ReadonlySet<string> =>
  new Set(
    holdings
      .filter((candidate) => isSyncedHolding(candidate, accountById.get(candidate.accountId)))
      .map((candidate) => candidate.id),
  );

// The return-row picker's options: every OPEN holding in the payer's own
// currency (v1 keeps a split single-currency), except any holding already
// picked in ANOTHER row and except a synced/syncable holding (a sync
// owns that holding's balance, so it can never be a return target). The payer
// holding IS an allowed return target: the net stays an expense and
// the balance nets on the payer with no double-count, so nothing is excluded by
// id here (`undefined` keeps `buildExchangeOptions` from dropping the payer).
// The eligible-TYPE gate is the primary picker's (`isTransactionEligibleType`):
// a change return is a plain ledger row, which a ledgerless holding never
// carries, so it would vanish from net worth.
export const buildReturnOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  accountById: ReadonlyMap<string, AccountRow>,
  payerCurrency: Currency,
  pickedElsewhere: ReadonlySet<string>,
): HoldingSelectOption[] => {
  const syncableIds = syncedHoldingIds(holdings, accountById);

  return buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    undefined,
    isTransactionEligibleType,
  ).filter(
    (option) =>
      option.currency === payerCurrency &&
      !pickedElsewhere.has(option.id) &&
      !syncableIds.has(option.id),
  );
};

// The loan-payment picker's options: every OPEN loan holding in the
// payment's own currency — a link is only ever valid same-currency;
// `transactionsRepo.setLoanPayment` itself refuses a cross-currency write,
// so this filter simply keeps the picker from ever OFFERING one. No
// synced-holding exclusion: a `debt` account (the only
// account kind a `loan` holding lives under) has no sync concept at all
// (see kiko-domain), so every loan holding is manual-owned already.
//
// A filter never hides an active selection (kiko-design-system): the row's
// OWN already-linked loan is unioned back in even when it has since closed
// or moved to another currency — `buildExchangeOptions` would otherwise drop
// it (closed) or the currency filter above would (a currency change), and
// the picker would then show no value at all for a link that still exists in
// the database, with no way for the user to see what it is or clear it.
export const buildLoanOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  paymentCurrency: Currency,
  selectedLoanHoldingId: string | null,
): HoldingSelectOption[] => {
  const openOptions = buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    undefined,
    (type) => type === 'loan',
  ).filter((option) => option.currency === paymentCurrency);

  if (
    selectedLoanHoldingId === null ||
    openOptions.some((option) => option.id === selectedLoanHoldingId)
  ) {
    return openOptions;
  }

  const selectedHolding = holdings.find((candidate) => candidate.id === selectedLoanHoldingId);

  if (selectedHolding === undefined) {
    return openOptions;
  }

  return [...openOptions, toHoldingOption(selectedHolding, accountNameById)];
};

// Order two holdings the way the Accounts screen shows them: primary by
// the parent account's display rank (its 0-based index in the sortOrder-ordered
// `accountsRepo.listQuery` list), then by the holding's own `sortOrder`, then
// `createdAt`. A holding whose account is not in the rank map sorts last, so a
// missing rank never reorders known accounts. Kept module-level and pure so
// `buildExchangeOptions` stays a plain filter/sort/map chain.
const compareByAccountThenHolding = (
  first: HoldingRow,
  second: HoldingRow,
  accountOrderById: ReadonlyMap<string, number>,
): number => {
  const firstRank = accountOrderById.get(first.accountId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = accountOrderById.get(second.accountId) ?? Number.MAX_SAFE_INTEGER;

  if (firstRank !== secondRank) {
    return firstRank - secondRank;
  }

  if (first.sortOrder !== second.sortOrder) {
    return first.sortOrder - second.sortOrder;
  }

  return first.createdAt - second.createdAt;
};

// Every OPEN, non-excluded holding except `excludeHoldingId`, projected to a
// picker option carrying its parent account name, ordered to
// match the Accounts screen (see `compareByAccountThenHolding`). The
// eligible TYPE test is injected by the caller so one builder serves create-mode
// (cash-only) and both convert-mode directions (the wider rules) without
// duplicating the projection. A closed holding is excluded so an exchange can
// never fund a holding the user has already closed out. Kept module-level (a
// pure projection of `holdings` + the account maps) so the component body's
// cognitive-complexity budget is spent on the render branching, not this list
// construction.
export const buildExchangeOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  excludeHoldingId: string | undefined,
  isEligibleType: (type: HoldingRow['type']) => boolean,
): HoldingSelectOption[] => {
  return holdings
    .filter(
      (candidate) =>
        candidate.id !== excludeHoldingId &&
        candidate.closedAt == null &&
        isEligibleType(candidate.type),
    )
    .sort((first, second) => compareByAccountThenHolding(first, second, accountOrderById))
    .map((candidate) => toHoldingOption(candidate, accountNameById));
};

// Whether a holding TYPE takes a plain manual transaction — the same gate
// `holdingDetailSpecs` (`holding-detail-spec/`) applies for its `'transaction'`
// action: a ledgerless type (term_deposit, bond, property_item — see
// `isLedgerlessHoldingType`) carries no manual ledger and is excluded;
// everything else (cash/card/crypto_asset/jar) is eligible. Mirrored here
// (rather than imported from that spec) so the primary picker and the
// footer action agree without a cross-feature import.
export const isTransactionEligibleType = (type: HoldingRow['type']): boolean =>
  !isLedgerlessHoldingType(type);

// The primary-leg picker's options for the global-add (empty-create) case:
// every OPEN, non-synced, transaction-eligible holding (mirroring the
// `'transaction'` gate above), projected and Accounts-ordered by the shared
// `buildExchangeOptions`. A synced holding's ledger is owned by its sync, so it
// can never be a manual-create target — excluded here the same way
// `buildReturnOptions` drops syncable holdings.
export const buildPrimaryOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  accountById: ReadonlyMap<string, AccountRow>,
): HoldingSelectOption[] => {
  const syncableIds = syncedHoldingIds(holdings, accountById);

  return buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    undefined,
    isTransactionEligibleType,
  ).filter((option) => !syncableIds.has(option.id));
};

// The id to seed the primary-holding seam with on the empty-create path, or
// null when there is nothing to seed yet (not an empty create, already seeded/
// picked, the query still loading, or no eligible holding at all). Prefers the
// user's most-recent MANUAL holding when it is still eligible, else the first
// Accounts-ordered eligible option. Gating the whole decision on
// `primaryHoldingId === null` makes it a one-shot seed that a later live refresh
// (or an in-progress user pick, which also makes the seam non-null) can never
// clobber. Kept module-level and pure so the seeding effect stays a thin
// dispatch and this branch chain stays out of the screen's cognitive-complexity
// budget.
export const resolveDefaultPrimaryHolding = (args: {
  isEmptyCreate: boolean;
  primaryHoldingId: string | null;
  latestManualLoading: boolean;
  latestManualHoldingId: string | null;
  options: readonly HoldingSelectOption[];
}): string | null => {
  const { isEmptyCreate, primaryHoldingId, latestManualLoading, latestManualHoldingId, options } =
    args;

  if (!isEmptyCreate || primaryHoldingId !== null || latestManualLoading || options.length === 0) {
    return null;
  }

  const recentIsEligible =
    latestManualHoldingId !== null && options.some((option) => option.id === latestManualHoldingId);

  return recentIsEligible ? latestManualHoldingId : options[0].id;
};
