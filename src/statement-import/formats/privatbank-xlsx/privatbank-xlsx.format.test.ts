import path from 'node:path';
import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import type { SpreadsheetCellValue, StatementFormatInput } from '@kiko/statement-import/parser';

import {
  COLUMN,
  CURRENCY_WORD_MAP,
  DATA_START_ROW_INDEX,
  HEADER_ROW_INDEX,
  PRIVATBANK_TITLE_PREFIX,
  privatbankXlsxFormat,
  // Imported through the folder's own barrel (matching `monobank-csv`'s
  // precedent) rather than `./privatbank-xlsx.format` directly, so
  // `index.ts` has a real consumer.
} from '.';

// The synthetic fixture (hand-authored, NOT uabean's real-looking sample —
// see the task report) — read as real bytes and run through the REAL
// `read-excel-file` OOXML parser, exactly the pre-parse step the file-read
// layer (the screen) performs before handing `sheetRows` to this format's
// `detect`/`parse` (see `StatementFormatInput.sheetRows`'s doc comment in
// `parser.ts`). This proves the fixture is a genuinely valid, parseable
// `.xlsx`, not just a structurally-plausible mock.
const FIXTURE_PATH = path.join(__dirname, '__fixtures__/synthetic-privatbank-sample.xlsx');

const readFixtureSheetRows = async (): Promise<SpreadsheetCellValue[][]> => {
  const buffer = readFileSync(FIXTURE_PATH);
  const sheets = await readXlsxFile(buffer);

  return sheets[0].data as SpreadsheetCellValue[][];
};

const fixtureInput = async (): Promise<StatementFormatInput> => ({
  text: '',
  fileName: 'synthetic-privatbank-sample.xlsx',
  sheetRows: await readFixtureSheetRows(),
});

const nonMatchingSpreadsheetInput: StatementFormatInput = {
  text: '',
  fileName: 'other-bank.xlsx',
  sheetRows: [
    ['Some Other Bank Statement', null],
    ['Date', 'Amount'],
    ['01.01.2024', '100'],
  ],
};

const csvInput: StatementFormatInput = {
  text: 'Дата,Сума\n01.01.2024,100\n',
  fileName: 'not-a-spreadsheet.csv',
};

// Regression fixture: a row whose amount cell is empty/malformed must never
// reach `Money.fromMajor` as `NaN` — it is routed
// to `unresolvedRows` as `invalid-amount` instead, the same "recoverable, not
// thrown, not silently dropped" treatment `unmapped-currency` already gets.
// Its currency word (`грн`) resolves cleanly, so `account.currency` still
// resolves to `UAH` even though this is the file's only row.
const invalidAmountInput: StatementFormatInput = {
  text: '',
  fileName: 'invalid-amount.xlsx',
  sheetRows: [
    [PRIVATBANK_TITLE_PREFIX, null, null, null, null, null, null, null, null, null],
    [
      'Дата',
      'Категорія',
      'Картка',
      'Опис операції',
      'Сума в валюті картки',
      'Валюта картки',
      'Сума в валюті транзакції',
      'Валюта транзакції',
      'Залишок на кінець періоду',
      'Валюта залишку',
    ],
    [
      '01.07.2025 10:15:00',
      'Супермаркети',
      '1111 **** **** 1111',
      'Bad Amount Row',
      '',
      'грн',
      '',
      'UAH',
      '0,00',
      'грн',
    ],
  ],
};

// The exported constants ARE the real contract a kiko:developer implements
// `detect`/`parse` against — pinned here so a future edit that
// silently drifts the title prefix, the row indices, the column order, or
// the currency-word map is caught by a real assertion, not just documented
// in a comment nothing enforces.
describe('privatbank-xlsx format constants', () => {
  it('anchors the title prefix and the title/header/data row indices exactly', () => {
    expect(PRIVATBANK_TITLE_PREFIX).toBe('Виписка з Ваших карток за період');
    expect(HEADER_ROW_INDEX).toBe(1);
    expect(DATA_START_ROW_INDEX).toBe(2);
  });

  it('anchors the header column order exactly', () => {
    expect(COLUMN).toEqual({
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
    });
  });

  it('maps the 4 known PrivatBank currency words, leaving фунт (GBP) unmapped on purpose', () => {
    expect(CURRENCY_WORD_MAP).toEqual({ грн: 'UAH', дол: 'USD', євро: 'EUR', PLN: 'PLN' });
    expect(CURRENCY_WORD_MAP.фунт).toBeUndefined();
  });
});

describe('privatbankXlsxFormat.detect', () => {
  it('accepts the synthetic fixture (cell A1 matches the PrivatBank title)', async () => {
    expect(privatbankXlsxFormat.detect(await fixtureInput())).toBe(true);
  });

  it('rejects a non-matching spreadsheet whose A1 cell is a different title', () => {
    expect(privatbankXlsxFormat.detect(nonMatchingSpreadsheetInput)).toBe(false);
  });

  it('rejects a CSV input (no sheetRows at all)', () => {
    expect(privatbankXlsxFormat.detect(csvInput)).toBe(false);
  });
});

describe('privatbankXlsxFormat.parse', () => {
  it('carries formatId "privatbank-xlsx" on the parsed statement', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.formatId).toBe('privatbank-xlsx');
  });

  // Deliberate exclusion (see `ParsedStatement.closingBalance`'s doc comment,
  // `parser.ts`): the fixture's own `balance`/`balanceCurrency` columns exist
  // per-row, but a PrivatBank export can mix MULTIPLE cards in one file (this
  // very fixture's two resolved rows carry DIFFERENT `maskedCardHint`s, see
  // below), so a single closing balance can't be attributed to one target
  // holding without also matching which card each row belongs to — never
  // guessed.
  it('never sets a closingBalance (a multi-card export has no single unambiguous balance)', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.closingBalance).toBeUndefined();
  });

  it('skips the merged A1:J1 title row and the row-2 header, starting data at row 3', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    // Exactly the 2 resolvable rows (row 5's unmapped currency is excluded
    // below) — neither the title row nor the header row is mistaken for data.
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0].description).toBe('Test Merchant One');
  });

  it('maps грн and дол to UAH and USD via the card-currency column', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.account.currency).toBe('UAH');
  });

  // Each row must carry ITS OWN resolved currency — a multi-currency
  // PrivatBank file mixes UAH and USD rows, and
  // `import-statement.ts` relies on this per-row field to exclude a
  // wrong-currency row instead of writing its amount verbatim into a
  // differently-denominated holding.
  it("carries each row's own resolved currency, not just the account's", async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.transactions[0].currency).toBe('UAH');
    expect(parsed.transactions[1].currency).toBe('USD');
  });

  it('reads the CARD-currency amount pair, not the transaction-currency one', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());
    const first = parsed.transactions[0];

    // Fixture row 3: card pair "-123,45 грн" vs. transaction pair
    // "-125,00 USD" — asserting -12345 (not -12500) proves the CARD pair won.
    expect(first.amountMinorUnits).toBe(-12_345);
  });

  it('parses the second row exactly (USD credit)', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());
    const second = parsed.transactions[1];

    expect(second.description).toBe('Test Merchant Two');
    expect(second.amountMinorUnits).toBe(5_000);
    expect(second.timeSeconds).toBe(1_751_455_845);
  });

  it('parses the DD.MM.YYYY HH:MM:SS date as UTC', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.transactions[0].timeSeconds).toBe(1_751_364_900);
  });

  it('carries no mcc on any row (PrivatBank has none)', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.transactions[0].mcc).toBeUndefined();
    expect(parsed.transactions[1].mcc).toBeUndefined();
  });

  it('surfaces each row’s distinct masked-card hint (multi-card export)', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.transactions[0].maskedCardHint).toBe('1111 **** **** 1111');
    expect(parsed.transactions[1].maskedCardHint).toBe('2222 **** **** 2222');
    expect(parsed.transactions[0].maskedCardHint).not.toBe(parsed.transactions[1].maskedCardHint);
  });

  it('surfaces an unmapped currency word as a recoverable "confirm currency" row, not a throw', async () => {
    const parsed = privatbankXlsxFormat.parse(await fixtureInput());

    expect(parsed.unresolvedRows).toEqual([
      {
        reason: 'unmapped-currency',
        rawCurrency: 'фунт',
        description: 'Test Merchant Three',
      },
    ]);
    // The unresolved row is excluded from `transactions` (its amount can't be
    // computed without knowing the currency), not silently mis-imported.
    expect(
      parsed.transactions.some((transaction) => transaction.description === 'Test Merchant Three'),
    ).toBe(false);
  });

  it('does not throw for a file detect() accepted, even with an unresolved row present', async () => {
    const input = await fixtureInput();

    expect(() => privatbankXlsxFormat.parse(input)).not.toThrow();
  });

  it('routes a row with an unparseable amount to unresolvedRows as invalid-amount, not a NaN write', () => {
    const parsed = privatbankXlsxFormat.parse(invalidAmountInput);

    expect(parsed.transactions).toHaveLength(0);
    expect(parsed.unresolvedRows).toEqual([
      { reason: 'invalid-amount', description: 'Bad Amount Row', rawAmount: '' },
    ]);
    // The row's currency word still resolved cleanly (грн), so the account
    // currency is still known even though its only row was excluded.
    expect(parsed.account.currency).toBe('UAH');
  });

  it('does not throw for a file whose only row is invalid-amount', () => {
    expect(() => privatbankXlsxFormat.parse(invalidAmountInput)).not.toThrow();
  });
});
