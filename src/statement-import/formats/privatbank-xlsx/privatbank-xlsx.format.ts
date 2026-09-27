// Column layout verified against docs/plans/statement-import.md
// (grounded in OSadovy/uabean's PrivatBank XLSX importer facts) — see
// src/statement-import/NOTICE.md. No uabean source or fixture is reused; this
// is an independent TypeScript implementation, and the fixture this format is
// tested against (`__fixtures__/synthetic-privatbank-sample.xlsx`) is
// hand-authored synthetic data, never uabean's real-looking sample.
import type {
  ParsedStatement,
  ParsedTransaction,
  SpreadsheetCellValue,
  StatementFormat,
  StatementFormatInput,
  UnresolvedStatementRow,
} from '@kiko/statement-import/parser';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import { isCurrency } from '@kiko/currency/currency';
import type { Currency } from '@kiko/currency/currency';
import { StatementParseError } from '@kiko/statement-import/parser';
import { parseDateTimeSeconds } from '@kiko/statement-import/parse-date-time';

// The exact PrivatBank detect signature: cell A1 of the
// exported sheet starts with this title prefix. Row 1 is a merged A1:J1
// title cell; the real header sits on row 2 (index 1), data starts row 3
// (index 2).
export const PRIVATBANK_TITLE_PREFIX = 'Виписка з Ваших карток за період';
export const HEADER_ROW_INDEX = 1;
export const DATA_START_ROW_INDEX = 2;

// PrivatBank's header row column order, 0-based against a
// `sheetRows` row.
export const COLUMN = {
  date: 0,
  category: 1,
  card: 2,
  description: 3,
  cardAmount: 4,
  cardCurrency: 5,
  transactionAmount: 6,
  transactionCurrency: 7,
  balance: 8,
  balanceCurrency: 9,
} as const;

// uabean's own map, confirmed incomplete by the plan
// — `[VERIFY LIVE]` the full abbreviation set (e.g. фунт/GBP is deliberately
// absent — an unmapped word surfaces as a recoverable `unresolvedRows` entry
// below, never a throw).
export const CURRENCY_WORD_MAP: Record<string, string> = {
  грн: 'UAH',
  дол: 'USD',
  євро: 'EUR',
  PLN: 'PLN',
};

// A resolved spreadsheet cell read as plain text — `read-excel-file` yields
// `null` for a genuinely blank cell (never `undefined`), which is not a valid
// `String()` input for the merged-title row's trailing cells.
const cellText = (value: SpreadsheetCellValue | undefined): string =>
  value === null || value === undefined ? '' : String(value);

const detect = (input: StatementFormatInput): boolean => {
  const titleCell = input.sheetRows?.[0]?.[0];

  return typeof titleCell === 'string' && titleCell.startsWith(PRIVATBANK_TITLE_PREFIX);
};

// One data row's outcome: either a fully resolved transaction (its card
// currency mapped cleanly AND its amount parsed to a finite number) or an
// unresolved row (an unmapped currency word, or an unparseable amount) — see
// `UnresolvedStatementRow`'s doc comment in `parser.ts` for why this is
// surfaced rather than thrown or silently dropped. `currency` is carried on
// the unresolved variant too, WHEN it is known (an `invalid-amount` row still
// resolved its currency word cleanly), so `parse` below can still learn the
// account's currency from a row whose amount alone was bad.
type RowOutcome =
  | { kind: 'resolved'; currency: Currency; transaction: ParsedTransaction }
  | { kind: 'unresolved'; currency?: Currency; row: UnresolvedStatementRow };

// MCC: PrivatBank's export carries none — every row maps to
// `category: null` through the generic mapper (`mapParsedTransaction`), so
// this never sets `mcc`. The `Категорія` text column is PrivatBank's own
// free-text label, not an MCC code, and is deliberately not read here.
const parseDataRow = (row: SpreadsheetCellValue[]): RowOutcome => {
  const description = cellText(row[COLUMN.description]);
  const rawCurrency = cellText(row[COLUMN.cardCurrency]);
  const mappedCurrency = CURRENCY_WORD_MAP[rawCurrency];

  if (mappedCurrency === undefined || !isCurrency(mappedCurrency)) {
    return { kind: 'unresolved', row: { reason: 'unmapped-currency', rawCurrency, description } };
  }

  // The CARD-currency amount pair, not the transaction-currency one (section
  // C.1) — the latter is informational and deliberately dropped. Guards
  // against ever computing a `NaN` `amountMinorUnits`: an empty or
  // malformed amount cell is routed to `unresolvedRows` instead, never
  // written.
  const rawAmount = cellText(row[COLUMN.cardAmount]);
  const amountMajor = parseAmount(rawAmount);

  if (!Number.isFinite(amountMajor)) {
    return {
      kind: 'unresolved',
      currency: mappedCurrency,
      row: { reason: 'invalid-amount', description, rawAmount },
    };
  }

  return {
    kind: 'resolved',
    currency: mappedCurrency,
    transaction: {
      currency: mappedCurrency,
      amountMinorUnits: Money.fromMajor(mappedCurrency, amountMajor).minorUnits,
      timeSeconds: parseDateTimeSeconds(cellText(row[COLUMN.date]), 'PrivatBank'),
      description,
      maskedCardHint: cellText(row[COLUMN.card]),
    },
  };
};

const parse = (input: StatementFormatInput): ParsedStatement => {
  const dataRows = (input.sheetRows ?? []).slice(DATA_START_ROW_INDEX);
  const transactions: ParsedTransaction[] = [];
  const unresolvedRows: UnresolvedStatementRow[] = [];
  let accountCurrency: Currency | undefined;

  for (const row of dataRows) {
    const outcome = parseDataRow(row);

    if (outcome.kind === 'unresolved') {
      unresolvedRows.push(outcome.row);
      accountCurrency ??= outcome.currency;
      continue;
    }

    accountCurrency ??= outcome.currency;
    transactions.push(outcome.transaction);
  }

  if (!accountCurrency) {
    throw new StatementParseError(
      'Could not detect the account currency from any resolvable PrivatBank row',
    );
  }

  return {
    formatId: 'privatbank-xlsx',
    account: { currency: accountCurrency },
    transactions,
    ...(unresolvedRows.length > 0 ? { unresolvedRows } : {}),
  };
};

export const privatbankXlsxFormat: StatementFormat = {
  id: 'privatbank-xlsx',
  displayName: 'PrivatBank (XLSX)',
  detect,
  parse,
};
