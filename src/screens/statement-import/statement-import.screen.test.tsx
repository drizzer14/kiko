import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '../../design-system/unistyles';

import { i18n } from '../../i18n';
import type { ParsedStatement, StatementFormat } from '../../statement-import/parser';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import StatementImportScreen from './statement-import.screen';

// The real uabean fixture (already committed by Task 1) — read as raw text
// then re-encoded as base64, the exact shape `RNFS.readFile(uri, 'base64')`
// hands the screen. Exercising the REAL `detectFormat`/`monobankCsvFormat`
// against a REAL base64-round-tripped payload (not a mocked parse result)
// proves the screen actually decodes base64 back to the original UTF-8 text
// (the fixture's Cyrillic descriptions) before handing it to the parser.
const fixtureText = readFileSync(
  path.join(
    __dirname,
    '../../statement-import/formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv',
  ),
  'utf-8',
);
const fixtureBase64 = Buffer.from(fixtureText, 'utf-8').toString('base64');

const unrelatedBase64 = Buffer.from(
  'Date,Amount,Description\n2024-01-01,-10.00,Coffee\n',
  'utf-8',
).toString('base64');

// The REAL Monobank header row (so `detect()` matches, exactly like the
// unrelated-format test above proves the opposite) followed by a data row
// whose date column is unparseable — `monobankCsvFormat.parse` throws a
// REAL `StatementParseError` out of `parseDateTimeSeconds` for this, since
// `detect()` only sniffs the header, never a data row. Proves the screen
// catches a parse-time throw rather than crashing (CRITICAL #1).
const malformedRowBase64 = Buffer.from(
  'Дата i час операції,Деталі операції,MCC,Сума в валюті картки (UAH),Сума в валюті операції,Валюта,Курс,Сума комісій (UAH),Сума кешбеку (UAH),Залишок після операції\n' +
    'not-a-date,Coffee,4829,10.00,10.00,UAH,—,—,—,100\n',
  'utf-8',
).toString('base64');

const mockReadFile = jest.fn();
jest.mock('react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Not used by this screen directly (only `account-detail.screen.tsx`'s
// `pickAndOpenStatement` opens the picker), mocked defensively per the task
// brief so an accidental transitive import never pulls in the real native
// binding under react-test-renderer.
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { csv: 'text/csv', xlsx: 'application/xlsx', plainText: 'text/plain', allFiles: '*/*' },
}));

const mockUseLiveQuery = jest.fn();
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      __kind: 'holdings-by-account',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    allQuery: () => ({ __kind: 'holdings-all', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    byIdQuery: (accountId: string) => ({ toSQL: () => ({ sql: '', params: [accountId] }) }),
  },
}));

const mockImportStatement = jest.fn();
jest.mock('../../statement-import/import-statement', () => ({
  importStatement: (...args: unknown[]) => mockImportStatement(...args),
}));

// A multi-card PrivatBank export can span MULTIPLE distinct masked cards
// (docs/plans/statement-import.md section C.1) — the preview must surface
// EACH row's own hint. `privatbank-xlsx.format.ts` is still a throwing stub
// at this point in the task split (Task 3 report), so this test drives the
// screen against a hand-built `ParsedStatement` through a wrapped
// `detectFormat`, keyed on one sentinel `fileName` — every OTHER test in this
// file keeps using the REAL `detectFormat`/`monobankCsvFormat` pipeline
// unchanged (`jest.requireActual` below), so this addition cannot affect any
// existing assertion.
const MULTI_CARD_FILE_NAME = 'multi-card-privatbank-trigger.xlsx';
const multiCardParsedStatement: ParsedStatement = {
  formatId: 'privatbank-xlsx',
  account: { currency: 'UAH', maskedPan: '1111 **** **** 1111' },
  transactions: [
    {
      currency: 'UAH',
      amountMinorUnits: -12_345,
      timeSeconds: 1_751_364_900,
      description: 'Test Merchant One',
      maskedCardHint: '1111 **** **** 1111',
    },
    {
      // A different currency than row 1 — this file is BOTH multi-card AND
      // multi-currency, exercising the preview's "detected currencies" list
      // (Task 3 review, CRITICAL fix) as well as the masked-card hint.
      currency: 'USD',
      amountMinorUnits: 5_000,
      timeSeconds: 1_751_455_845,
      description: 'Test Merchant Two',
      maskedCardHint: '2222 **** **** 2222',
    },
  ],
};
const multiCardFormatStub: StatementFormat = {
  id: 'privatbank-xlsx',
  displayName: 'PrivatBank (XLSX)',
  detect: () => true,
  parse: () => multiCardParsedStatement,
};

jest.mock('../../statement-import/registry', () => {
  const actual = jest.requireActual('../../statement-import/registry');
  return {
    ...actual,
    detectFormat: (input: { text: string; fileName: string }) =>
      input.fileName === MULTI_CARD_FILE_NAME ? multiCardFormatStub : actual.detectFormat(input),
  };
});

// The target-holding picker has its own dedicated test file
// (`target-holding-sheet/target-holding-sheet.component.test.tsx`) — mocked
// here to a minimal stand-in exposing one `onSelect` trigger per holding the
// screen hands it, following `account-detail.screen.test.tsx`'s precedent of
// mocking a sub-section under its own test elsewhere (`crypto-sync-section`).
jest.mock('./target-holding-sheet', () => {
  const { Pressable, Text: RNText } = require('react-native');
  return {
    __esModule: true,
    default: ({
      holdings,
      onSelect,
    }: {
      holdings: { id: string; name: string }[];
      onSelect: (holdingId: string) => void;
    }) => (
      <>
        {holdings.map((holding) => (
          <Pressable
            key={holding.id}
            testID={`mock-select-holding-${holding.id}`}
            onPress={() => onSelect(holding.id)}
          >
            <RNText>{holding.name}</RNText>
          </Pressable>
        ))}
      </>
    ),
  };
});

type StatementImportProps = ComponentProps<typeof StatementImportScreen>;

const renderScreen = async (params: { filePath: string; accountId?: string }) => {
  const navigation = navigationSpy();
  const route = asRouteProp<StatementImportProps['route']>('StatementImport', params);
  const view = await render(
    <StatementImportScreen
      route={route}
      navigation={asNavigationProp<StatementImportProps['navigation']>(navigation)}
    />,
  );
  return { ...view, navigation };
};

describe('StatementImportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLiveQuery.mockReturnValue({
      data: [{ id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' }],
    });
  });

  it('reads the picked file, recognizes the Monobank CSV format, and renders its preview', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getByText, getByTestId } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());
    expect(getByTestId('statement-import-transaction-count')).toHaveTextContent('4');
    expect(getByTestId('statement-import-currency')).toHaveTextContent('UAH');
    // Timezone-robust: assert the real parsed min/max years surfaced, without
    // pinning the exact day (`formatDate` reads LOCAL calendar fields, and the
    // fixture's first/last rows are 01.04.2022 / 12.05.2023).
    const dateSpan = getByTestId('statement-import-date-span');
    expect(dateSpan).toHaveTextContent(/2022/);
    expect(dateSpan).toHaveTextContent(/2023/);
    expect(getByText(i18n.t('statementImport.chooseHolding'))).toBeTruthy();
  });

  it('shows the "we don\'t recognize this file" state for a non-matching format, with no error thrown', async () => {
    mockReadFile.mockResolvedValue(unrelatedBase64);

    const { getByText, queryByTestId } = await renderScreen({
      filePath: '/mock/other.csv',
      accountId: 'a',
    });

    await waitFor(() =>
      expect(getByText(i18n.t('statementImport.unrecognizedFormat'))).toBeTruthy(),
    );
    expect(queryByTestId('statement-import-transaction-count')).toBeNull();
  });

  it('shows the same graceful state (not a crash) when detect() matches but parse() throws on a bad data row', async () => {
    mockReadFile.mockResolvedValue(malformedRowBase64);

    const { getByText, queryByTestId } = await renderScreen({
      filePath: '/mock/bad-row.csv',
      accountId: 'a',
    });

    await waitFor(() =>
      expect(getByText(i18n.t('statementImport.unrecognizedFormat'))).toBeTruthy(),
    );
    expect(queryByTestId('statement-import-transaction-count')).toBeNull();
  });

  it('shows the same graceful state (not a crash) when the file read itself fails', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: file not found'));

    const { getByText, queryByTestId } = await renderScreen({
      filePath: '/mock/missing.csv',
      accountId: 'a',
    });

    await waitFor(() =>
      expect(getByText(i18n.t('statementImport.unrecognizedFormat'))).toBeTruthy(),
    );
    expect(queryByTestId('statement-import-transaction-count')).toBeNull();
  });

  it('selecting a holding then pressing Import calls importStatement with the decoded text and shows the imported count', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    mockImportStatement.mockResolvedValue({ formatId: 'monobank-csv', imported: 3, total: 4 });

    const { getByText, getByTestId } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());

    await fireEvent.press(getByTestId('mock-select-holding-h1'));
    await fireEvent.press(getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportStatement).toHaveBeenCalledTimes(1));
    // The decoded text passed to `importStatement` must be the REAL, base64-
    // round-tripped fixture content (proving the screen actually decoded it),
    // not the raw base64 string and not a hand-typed literal.
    expect(mockImportStatement).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Дата i час операції') }),
      'h1',
    );
    expect(
      getByText(i18n.t('statementImport.importedCount', { imported: 3, total: 4 })),
    ).toBeTruthy();
  });

  it('surfaces each row’s distinct masked-card hint in a multi-card PrivatBank preview', async () => {
    mockReadFile.mockResolvedValue('irrelevant-base64-the-mocked-detectFormat-ignores-it');

    const { getByText } = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('PrivatBank (XLSX)')).toBeTruthy());
    expect(getByText('1111 **** **** 1111')).toBeTruthy();
    expect(getByText('2222 **** **** 2222')).toBeTruthy();
  });

  it('still requires an explicit holding pick before importing a multi-card PrivatBank file, even with a hint shown', async () => {
    mockReadFile.mockResolvedValue('irrelevant-base64-the-mocked-detectFormat-ignores-it');
    mockImportStatement.mockResolvedValue({ formatId: 'privatbank-xlsx', imported: 2, total: 2 });

    const { getByText, getByTestId } = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('PrivatBank (XLSX)')).toBeTruthy());

    // No holding picked yet: pressing Import must NOT auto-route by either
    // card hint shown above — the masked-card hint is a display suggestion
    // only, never a silent target pick (section C.1).
    await fireEvent.press(getByText(i18n.t('statementImport.importButton')));
    expect(mockImportStatement).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('mock-select-holding-h1'));
    await fireEvent.press(getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportStatement).toHaveBeenCalledTimes(1));
    expect(mockImportStatement).toHaveBeenCalledWith(expect.anything(), 'h1');
  });

  // Task 3 review, CRITICAL fix: a multi-currency file's preview must
  // surface EVERY detected currency BEFORE the user picks a holding, so they
  // can pick one that actually matches (`importStatement` excludes any row
  // whose currency doesn't).
  it("surfaces the file's multiple detected currencies in the preview", async () => {
    mockReadFile.mockResolvedValue('irrelevant-base64-the-mocked-detectFormat-ignores-it');

    const { getByText, getByTestId } = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('PrivatBank (XLSX)')).toBeTruthy());
    expect(getByText(i18n.t('statementImport.detectedCurrenciesLabel'))).toBeTruthy();

    const detectedCurrencies = within(getByTestId('statement-import-detected-currencies'));
    expect(detectedCurrencies.getByText('UAH')).toBeTruthy();
    expect(detectedCurrencies.getByText('USD')).toBeTruthy();
  });

  it('surfaces the skipped-wrong-currency count after a real import excludes some rows', async () => {
    mockReadFile.mockResolvedValue('irrelevant-base64-the-mocked-detectFormat-ignores-it');
    mockImportStatement.mockResolvedValue({
      formatId: 'privatbank-xlsx',
      imported: 1,
      total: 2,
      skippedWrongCurrency: 1,
    });

    const { getByText, getByTestId } = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('PrivatBank (XLSX)')).toBeTruthy());
    await fireEvent.press(getByTestId('mock-select-holding-h1'));
    await fireEvent.press(getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(getByText(i18n.t('statementImport.skippedWrongCurrency', { count: 1 }))).toBeTruthy(),
    );
  });
});
