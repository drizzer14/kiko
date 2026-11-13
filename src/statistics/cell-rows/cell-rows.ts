import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import type { CalendarMonth } from '@kiko/dates';
import type { AccountRow, HoldingRow } from '@kiko/db';
import type { RateTable } from '@kiko/rates/conversion';
import type { Currency } from '@kiko/currency/currency';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import type { CategoryDisplay } from '@kiko/categories/category-display';
import { transactionRowDescription } from '@kiko/transactions/row-description';

import { incomeAmountOf } from '../cash-flow';
import { spendingContributionsOf } from '../category-breakdown';
import { type LoanEntryPart, loanEntryPartOf, loanPaymentIdOf } from '../loan-payments';
import { type LedgerRow, type SpendingLedger, spendingRowsIn } from '../spending-ledger';

/** One row of the list a table cell opens; the rows' base amounts add up to the cell. */
export type CellRow = {
  id: string;
  /** The stored transaction a tap opens: a derived loan entry's payment, else the row itself. */
  transactionId: string;
  time: number;
  description: string;
  /** In the row's own currency. For a payment with change returned, what is left of it. */
  native: Money;
  /** The same in the base currency, converted as the table converts it. */
  base: Money;
  /** Set on an entry derived from a loan payment: which part of the payment it is. */
  loanPart?: LoanEntryPart;
  /** `loan_interest` for an interest entry, the payment's category for an excess entry. */
  category: string | null;
  /** As Home names the account; empty when the row's payment is not among the shown rows. */
  accountName: string;
  /** Null when the row's holding is not known. */
  holdingType: HoldingType | null;
  /** The loan a payment is linked to; a derived loan entry takes its payment's. */
  loanHoldingId: string | null;
  /** `base` and `native` stay positive; the card signs them by this, as Home does. */
  flow: 'expense' | 'income';
};

/** The time span a table cell covers: a month's, or the whole period's for a Total. */
export type CellRange = Pick<CalendarMonth, 'start' | 'end'>;

/** What a row's card shows of its holding: its label, its account and its type. */
export type RowContext = (row: LedgerRow) => {
  description: string;
  accountName: string;
  holdingType: HoldingType | null;
};

/**
 * Describes a row the way Home does (`transactionRowDescription`): its own description, else the
 * default label of its holding, so a cash expense with none reads "Cash expense" in a sheet too.
 * The account is named as every screen names it (`accountDisplayName`), since an implicit
 * account's stored name is an English sentinel.
 */
export const rowContextOf = (
  holdings: readonly Pick<HoldingRow, 'id' | 'name' | 'currency' | 'type' | 'accountId'>[],
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'name' | 'archivedAt'>[],
  t: TFunction,
): RowContext => {
  const holdingNameById = new Map(holdings.map((holding) => [holding.id, holding.name]));
  const holdingCurrencyById = new Map(holdings.map((holding) => [holding.id, holding.currency]));
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return (row) => {
    const holding = holdingById.get(row.holdingId);
    const account = foldMap(maybe(holding), ({ accountId }) => accountById.get(accountId));

    return {
      description: transactionRowDescription({
        transaction: row,
        holdingName: holdingNameById.get(row.holdingId) ?? '',
        holdingNameById,
        holdingCurrencyById,
        t,
      }),
      accountName: foldMap(maybe(account), (found) => accountDisplayName(found, t)) ?? '',
      holdingType: foldMap(maybe(holding), ({ type }) => type) ?? null,
    };
  };
};

type ExpenseDisplay = {
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  context: RowContext;
};

/** Newest first; rows of one time by id, so the order never moves between renders. */
const newestFirst = (left: CellRow, right: CellRow): number => {
  if (left.time !== right.time) {
    return right.time - left.time;
  }

  return left.id < right.id ? -1 : 1;
};

/**
 * The rows of an expense cell: the rows the donut sums for the range, each through the donut's own
 * conversion, so they add up to the cell. A `categoryKey` is a category row's cell; none is an
 * All cell, which `excludedCategories` (the pick its table was built with) narrows. The cash
 * flow's expense cell passes neither, since a category pick never changes it. A derived loan entry
 * names its payment and which part of it the entry is, and takes the payment's label, which it
 * has none of itself.
 */
export const expenseRowsOf = (
  ledger: SpendingLedger,
  range: CellRange,
  held: { categoryKey?: string; excludedCategories?: ReadonlySet<string> },
  display: ExpenseDisplay,
): CellRow[] => {
  const { context, ...conversion } = display;
  const sourceById = new Map(ledger.shownRows.map((row) => [row.id, row]));

  return spendingContributionsOf({
    ...conversion,
    transactions: spendingRowsIn(ledger, range.start, range.end),
    excludedCategories: held.excludedCategories,
    excludedTransactionIds: ledger.excludedTransactionIds,
  })
    .filter(({ key }) => held.categoryKey === undefined || key === held.categoryKey)
    .map(({ transaction, netMagnitude, baseMinorUnits }): CellRow => {
      const paymentId = loanPaymentIdOf(transaction.id);
      // A derived entry has no holding of its own: its payment's row names the account and the
      // holding type. With no such row they stay empty, as the description keeps its own text;
      // the fields are display-only and never feed a write.
      const source = maybe(sourceById.get(paymentId ?? transaction.id));
      const sourceContext = foldMap(source, context);

      return {
        id: transaction.id,
        transactionId: paymentId ?? transaction.id,
        time: transaction.time,
        description: sourceContext?.description ?? transaction.description,
        native: Money.of(transaction.currency, netMagnitude),
        base: Money.of(display.baseCurrency, baseMinorUnits),
        ...foldMap(maybe(loanEntryPartOf(transaction.id)), (part) => ({ loanPart: part })),
        category: transaction.category,
        accountName: sourceContext?.accountName ?? '',
        holdingType: sourceContext?.holdingType ?? null,
        loanHoldingId: foldMap(source, (row) => row.loanHoldingId) ?? null,
        flow: 'expense',
      };
    })
    .sort(newestFirst);
};

/**
 * The rows of an income cell: the shown credits in the range that `incomeAmountOf` takes, each
 * converted at today's rate as the cash flow's income cell converts it.
 */
export const incomeRowsOf = (
  ledger: SpendingLedger,
  range: CellRange,
  rateTable: RateTable,
  baseCurrency: Currency,
  context: RowContext,
): CellRow[] =>
  ledger.shownRows
    .filter((row) => row.time >= range.start && row.time <= range.end)
    .flatMap(
      (row): CellRow[] =>
        foldMap(
          maybe(incomeAmountOf(row, ledger.excludedTransactionIds, rateTable, baseCurrency)),
          (base) => [
            {
              id: row.id,
              transactionId: row.id,
              time: row.time,
              ...context(row),
              native: Money.of(row.currency, row.amountMinorUnits),
              base,
              category: row.category,
              loanHoldingId: row.loanHoldingId,
              flow: 'income',
            },
          ],
        ) ?? [],
    )
    .sort(newestFirst);
