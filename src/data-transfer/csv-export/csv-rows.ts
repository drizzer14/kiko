import type { TFunction } from 'i18next';
import {
  accountKindByHoldingIdOf,
  balanceSetIdsOf,
  ledgerRowsOf,
  loanHoldingsOf,
  ownIbansOf,
} from '@kiko/statistics/spending-ledger';
import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
} from '@kiko/categories/category-display';
import maybe, { foldMap } from 'fnts/maybe';
import {
  descriptionExcludedTransferTransactionIds,
  mccExcludedTransferTransactionIds,
} from '@kiko/statistics/transfer-exclusion';
import {
  exchangeExcludedTransactionIds,
  sameCurrencyMoveTransactionIds,
} from '@kiko/statistics/exchange-exclusion';
import {
  internalTransferTransactionIds,
  rowsForTransferMatch,
} from '@kiko/statistics/internal-transfers';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';
import { exchangeFundingMatches } from '@kiko/statistics/exchange-funding-match';
import { loanPaymentExcludedTransactionIds } from '@kiko/statistics/loan-payments';

import type { DataSnapshot } from '../snapshot/data-snapshot';

import { type CsvDialect, csvAmountCell, csvTextCell } from './csv-cell';

type CsvTransactionType = 'expense' | 'income' | 'transfer' | 'exchange' | 'loan' | 'balance';

type LedgerFacts = {
  transactions: readonly TransactionRow[];
  holdings: readonly HoldingRow[];
  accounts: readonly AccountRow[];
};

type CsvSnapshot = Pick<
  DataSnapshot,
  'accounts' | 'holdings' | 'transactions' | 'categories' | 'settings'
>;

const COLUMNS = [
  'date',
  'account',
  'holding',
  'amount',
  'currency',
  'category',
  'description',
  'comment',
  'type',
  'pending',
  'source',
] as const;

const union = (...sets: ReadonlySet<string>[]): ReadonlySet<string> =>
  new Set(sets.flatMap((set) => [...set]));

const byTimeThenId = (
  first: Pick<TransactionRow, 'id' | 'time'>,
  second: Pick<TransactionRow, 'id' | 'time'>,
): number => first.time - second.time || (first.id > second.id ? 1 : -1);

/**
 * What a row is, as a label over the rules Statistics already applies, over the WHOLE ledger so a
 * partner under an archived account still counts. The strongest rule wins: a stored balance mark
 * is the app's own correction; a linked loan payment is a deliberate link; an exchange marker or
 * pair is structural; a transfer is only inferred from an amount, a code or a wording. A row
 * none of them catches reads by its sign.
 *
 * The rows are handed to the matchers in the order they arrive, which must be the app's own read
 * (`readCsvSnapshot`): the transfer matcher claims greedily in the order it is given, so with two
 * debits competing for one credit another order would pair a different one.
 */
export const csvTransactionType = ({
  transactions,
  holdings,
  accounts,
}: LedgerFacts): ((row: Pick<TransactionRow, 'id' | 'amountMinorUnits'>) => CsvTransactionType) => {
  const ledger = ledgerRowsOf(transactions, holdings);
  const rules: readonly (readonly [CsvTransactionType, ReadonlySet<string>])[] = [
    ['balance', balanceSetIdsOf(ledger)],
    ['loan', loanPaymentExcludedTransactionIds(ledger, loanHoldingsOf(holdings))],
    [
      'exchange',
      union(
        exchangeExcludedTransactionIds(ledger),
        sameCurrencyMoveTransactionIds(ledger),
        exchangeFundingMatches(ledger, accountKindByHoldingIdOf(accounts, holdings)).excludedIds,
      ),
    ],
    [
      'transfer',
      union(
        internalTransferTransactionIds(rowsForTransferMatch(ledger)),
        mccExcludedTransferTransactionIds(ledger, ownIbansOf(holdings)),
        descriptionExcludedTransferTransactionIds(ledger),
      ),
    ],
  ];

  return (row) =>
    foldMap(maybe(rules.find(([, ids]) => ids.has(row.id))), ([type]) => type) ??
    (row.amountMinorUnits > 0 ? 'income' : 'expense');
};

const pad = (value: number): string => value.toString().padStart(2, '0');

// The device's local wall clock, as the app shows it, with no zone column.
const dateTimeOf = (time: number): string => {
  const date = new Date(time);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * The CSV file's text: every row of every non-archived account, oldest first, with a byte order
 * mark and CRLF line ends. Ids, IBANs, the card mask and every secret are never columns.
 */
export const buildCsvText = (input: {
  snapshot: CsvSnapshot;
  dialect: CsvDialect;
  t: TFunction;
}): string => {
  const { snapshot, dialect, t } = input;
  const typeOf = csvTransactionType(snapshot);
  const accountById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const holdingById = new Map(snapshot.holdings.map((holding) => [holding.id, holding]));
  const categoryByKey = buildCategoryDisplayMap(snapshot.categories);
  const defaultCategoryKey = snapshot.settings.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  const rowOf = (transaction: TransactionRow): string[] => {
    const holding = holdingById.get(transaction.holdingId);
    const account = foldMap(maybe(holding), ({ accountId }) => accountById.get(accountId));

    if (holding === undefined || account === undefined || account.archivedAt != null) {
      return [];
    }

    const category = resolveCategoryDisplay(
      transaction.category,
      categoryByKey,
      defaultCategoryKey,
    );

    return [
      dateTimeOf(transaction.time),
      csvTextCell(accountDisplayName(account, t)),
      csvTextCell(holding.name),
      csvAmountCell(transaction.amountMinorUnits, holding.currency, dialect),
      holding.currency,
      csvTextCell(category.title),
      csvTextCell(transaction.description),
      csvTextCell(transaction.comment ?? ''),
      t(`settings.csvExport.types.${typeOf(transaction)}`),
      t(`settings.csvExport.pending.${transaction.hold === true ? 'yes' : 'no'}`),
      t(`settings.csvExport.sources.${transaction.source}`),
    ];
  };

  const rows = [...snapshot.transactions].sort(byTimeThenId).map(rowOf);
  const header = COLUMNS.map((column) => csvTextCell(t(`settings.csvExport.columns.${column}`)));
  const lines = [header, ...rows.filter((cells) => cells.length > 0)].map((cells) =>
    cells.join(dialect.delimiter),
  );

  return '\uFEFF'.concat(lines.join('\r\n'), '\r\n');
};
