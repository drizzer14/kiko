import path from 'node:path';
import { Alert } from 'react-native';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type {
  ParsedStatement,
  StatementFormat,
  StatementFormatInput,
} from '@kiko/statement-import/parser';
import { scrollToField } from '@kiko/design-system/scroll-to-field';
import { previewStats } from '@kiko/statement-import/preview-stats';
import { headerFingerprint } from '@kiko/statement-import/column-mapping';
import { statementFormats, supportedFormatNames } from '@kiko/statement-import/registry';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import StatementImportScreen from './statement-import.screen';

// The real uabean fixture — read as raw text then re-encoded as base64, the
// exact shape `RNFS.readFile(uri, 'base64')`
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
// The fixture's own real header row — used to build a saved mapping whose
// `fingerprint` genuinely matches this file (the auto-replace check).
const fixtureHeaderRow = fixtureText.split('\n')[0].split(',');

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
const mockUnlink = jest.fn();
jest.mock('react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  CachesDirectoryPath: '/mock/caches',
}));

// Not used by this screen directly (only `account-detail.screen.tsx`'s
// `pickAndOpenStatement` opens the picker), mocked defensively anyway so an
// accidental transitive import never pulls in the real native binding under
// react-test-renderer.
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { csv: 'text/csv', xlsx: 'application/xlsx', plainText: 'text/plain', allFiles: '*/*' },
}));

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      __kind: 'holdings-by-account',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    byIdQuery: (accountId: string) => ({
      __kind: 'account-by-id',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
  },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ __kind: 'settings', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

const mockReadSheetRowsSafely = jest.fn();
jest.mock('@kiko/statement-import/read-statement-file', () => ({
  ...jest.requireActual('@kiko/statement-import/read-statement-file'),
  readSheetRowsSafely: (...args: unknown[]) => mockReadSheetRowsSafely(...args),
}));

jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const mockImportStatement = jest.fn();
jest.mock('@kiko/statement-import/import-statement', () => ({
  importStatement: (...args: unknown[]) => mockImportStatement(...args),
}));

// The balance preview read has its own tests; this file only proves what the
// screen hands it and what it shows of the answer.
const mockUseImportBalancePreview = jest.fn().mockReturnValue(undefined);
jest.mock('@kiko/statement-import/use-import-balance-preview', () => ({
  useImportBalancePreview: (...args: unknown[]) => mockUseImportBalancePreview(...args),
}));

// A multi-card PrivatBank export can span MULTIPLE distinct masked cards —
// the preview must surface EACH row's own hint. No real fixture file covers
// this multi-card shape, so this test drives the screen against a hand-built
// `ParsedStatement` through
// a wrapped `detectFormat`, keyed on one sentinel `fileName` — every OTHER
// test in this file keeps using the REAL `detectFormat`/`monobankCsvFormat`
// pipeline unchanged (`jest.requireActual` below), so this addition cannot
// affect any existing assertion.
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
      // as well as the masked-card hint.
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

// The screen's cp1251 decode FALLBACK, isolated from
// `sensebank-csv.format.ts`'s own CSV-shape logic. This sentinel format's
// `detect` checks for the CORRECTLY cp1251-decoded literal Sensebank
// preamble text — it never imports the real `sensebank-csv` module — so
// these tests prove ONLY that the screen itself retries with a cp1251 decode
// when the UTF-8 pass finds no match, not that the real format module works.
const SENSEBANK_TRIGGER_FILE_NAME = 'sensebank-decode-trigger.csv';
// The literal preamble line `sensebankCsvFormat.detect` will
// eventually check for too — matches `SENSEBANK_PREAMBLE` in
// `sensebank-csv.format.ts` exactly (not imported from there, kept as an
// independent literal here on purpose, so this test's pass/fail is never
// coupled to that module's own export surface).
const SENSEBANK_DECODED_PREAMBLE = 'Виписка за рахунком;;;;;;;';
// The SAME preamble line, cp1251-ENCODED then base64-encoded — exactly the
// shape `RNFS.readFile(uri, 'base64')` would hand the screen for a real
// Sensebank export. Computed via the REAL `windows-1251` library's own
// `encode()` at authoring time and verified via a roundtrip `decode()`;
// NOT derived from any decode call this test file makes
// itself, so this is a genuine fixed-bytes input, not a tautology.
const sensebankPreambleCp1251Base64 = 'wujv6PHq4CDn4CDw4PXz7eru7Ds7Ozs7Ozs=';
const sensebankParsedStatement: ParsedStatement = {
  formatId: 'sensebank-csv',
  account: { currency: 'UAH' },
  transactions: [
    {
      currency: 'UAH',
      amountMinorUnits: -15_000,
      timeSeconds: 947_379_480,
      description: 'Щомісячна комісія за обслуговування пакета банківських послуг',
    },
  ],
};
const sensebankFormatStub: StatementFormat = {
  id: 'sensebank-csv',
  displayName: 'Sensebank (CSV)',
  detect: (input) => input.text.startsWith(SENSEBANK_DECODED_PREAMBLE),
  parse: () => sensebankParsedStatement,
};
// Records every `input.text` the mocked `detectFormat` sees for the sentinel
// file, in call order — lets a test prove the screen actually RETRIES a
// second decode attempt (cp1251) rather than giving up after the first
// (UTF-8) attempt finds no match.
const sensebankDetectFormatCalls: string[] = [];
// The whole input the mocked `detectFormat` was handed for the multi-card
// sentinel — proves which text/spreadsheet rows the screen built from the file.
const multiCardDetectedInputs: StatementFormatInput[] = [];

jest.mock('@kiko/statement-import/registry', () => {
  const actual = jest.requireActual('@kiko/statement-import/registry');

  return {
    ...actual,
    detectFormat: (input: StatementFormatInput) => {
      if (input.fileName === MULTI_CARD_FILE_NAME) {
        multiCardDetectedInputs.push(input);

        return multiCardFormatStub;
      }

      if (input.fileName === SENSEBANK_TRIGGER_FILE_NAME) {
        sensebankDetectFormatCalls.push(input.text);

        return sensebankFormatStub.detect(input) ? sensebankFormatStub : undefined;
      }

      mockDetectFormat(input);

      return actual.detectFormat(input);
    },
  };
});

// Counts the real, cross-format `detectFormat` calls (the sentinel files above do not reach it).
const mockDetectFormat = jest.fn();
// A pass-through, so a test can count how often the screen recomputes the preview stats.
jest.mock('@kiko/statement-import/preview-stats', () => {
  const actual = jest.requireActual('@kiko/statement-import/preview-stats');

  return { ...actual, previewStats: jest.fn(actual.previewStats) };
});

// The target-holding picker has its own dedicated test file
// (`target-holding-sheet/target-holding-sheet.component.test.tsx`) — mocked
// here to a minimal stand-in exposing one `onSelect` trigger per holding the
// screen hands it, following `account-detail.screen.test.tsx`'s precedent of
// mocking a sub-section under its own test elsewhere (`crypto-sync-section`).
jest.mock('@kiko/design-system/components/target-holding-sheet', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({
      holdings,
      onSelect,
      onCreateNew,
    }: {
      holdings: { id: string; name: string }[];
      onSelect: (holdingId: string) => void;
      onCreateNew: () => void;
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
        <Pressable testID="mock-create-new-holding" onPress={onCreateNew}>
          <RNText>Create new holding</RNText>
        </Pressable>
      </>
    ),
  };
});

type StatementImportProps = ComponentProps<typeof StatementImportScreen>;

const renderScreen = async (params: {
  filePath: string;
  accountId: string;
  expectedFormatId?: string;
  holdingId?: string;
  isFocused?: boolean;
}) => {
  const { isFocused, ...routeParams } = params;
  const navigation = navigationSpy();
  navigation.isFocused.mockReturnValue(isFocused ?? true);
  const route = asRouteProp<StatementImportProps['route']>('StatementImport', routeParams);
  const view = await render(
    <StatementImportScreen
      route={route}
      navigation={asNavigationProp<StatementImportProps['navigation']>(navigation)}
    />,
  );

  return { ...view, navigation };
};

// Drives the `useLiveQuery` calls this screen (plus the shared
// `useTargetHoldingOptions` hook it renders through) makes, keyed on the
// query's own `__kind` — the account-by-id and settings queries need their
// own shapes (the auto-replace-to-ColumnMapping check), everything else
// (the holdings/accounts-list pair `useTargetHoldingOptions` reads) keeps
// the same single-holding default every other test in this file relies on.
// `accountIsLoading`/`settingsIsLoading` default to `false` (an already-
// resolved query) so every existing call site keeps behaving exactly as
// before; a test that cares about the cold-start ordering passes one or
// both explicitly.
const setLiveData = (data: {
  holdings?: { id: string; name: string; accountId: string; accountName: string; type?: string }[];
  account?: { id: string; name?: string; bankId?: string | null };
  statementMappings?: Record<string, unknown> | null;
  accountIsLoading?: boolean;
  settingsIsLoading?: boolean;
  noSettingsRow?: boolean;
}): void => {
  const holdings = data.holdings ?? [
    { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
  ];

  // A query the screen subscribes to under the wrong table list would never
  // refresh on the real database, so a mismatch here throws instead of
  // answering.
  const expectTables = (tables: string[], expected: string): void => {
    if (tables[0] !== expected) {
      throw new Error(`unexpected live-query tables ${JSON.stringify(tables)}`);
    }
  };

  mockUseLiveQuery.mockImplementation((query: { __kind?: string }, tables: string[]) => {
    if (query.__kind === 'account-by-id') {
      expectTables(tables, 'accounts');

      return {
        data: data.account ? [data.account] : [],
        isLoading: data.accountIsLoading ?? false,
      };
    }

    if (query.__kind === 'settings') {
      expectTables(tables, 'settings');

      return {
        data: data.noSettingsRow ? [] : [{ statementMappings: data.statementMappings ?? null }],
        isLoading: data.settingsIsLoading ?? false,
      };
    }

    return { data: holdings, isLoading: false };
  });
};

describe('StatementImportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({});
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
    // "Choose a holding" is a SELECT FIELD — its caption AND its unselected
    // placeholder value both show this text, so two matches are expected;
    // the field itself is asserted by testID.
    expect(getByTestId('target-holding-field')).toBeTruthy();
  });

  // The preview heading (the format's own
  // displayName) renders exactly once, through this screen's own `Text`
  // rather than `SummaryTable`'s `title` row — so it sits at the same 12pt
  // gap-driven spacing every column-mapping section heading uses, not
  // `SummaryTable`'s own internal `gap={1}` (4pt).
  it('renders the preview heading exactly once', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getAllByText } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
    });

    await waitFor(() => expect(getAllByText('Monobank (CSV)')).toHaveLength(1));
  });

  // Regression guard: `account-detail.screen.tsx` resolves this
  // route's `expectedFormatId` via `statementFormatIdForBank(account.bankId)`,
  // which is `undefined` for a bank-less Bank account (`bankId: null` — a
  // valid, tested state the account-form edit picker can now return an
  // account to). With no `expectedFormatId` at all this screen must still
  // fall back to the multi-format `detectFormat` auto-detect AND still offer
  // the "Map columns manually" escape hatch.
  it('detects a dedicated format via multi-format auto-detect, and still offers "Map columns manually", with no expectedFormatId at all', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getByText } = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());
    expect(getByText(i18n.t('statementImport.mapColumnsManually'))).toBeTruthy();
  });

  it('still recognizes the real file when expectedFormatId matches its actual format', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getByText } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'monobank-csv',
    });

    await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());
  });

  it('shows a bank-mismatch reason, not the generic unrecognized-format text, when the file matches a DIFFERENT bank than expected', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getByText, queryByTestId, queryByText } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() =>
      expect(
        getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
      ).toBeTruthy(),
    );
    expect(
      queryByText(i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames })),
    ).toBeNull();
    expect(queryByTestId('statement-import-transaction-count')).toBeNull();
  });

  it('shows the "we don\'t recognize this file" state for a non-matching format, with no error thrown', async () => {
    mockReadFile.mockResolvedValue(unrelatedBase64);

    const { getByText, queryByTestId } = await renderScreen({
      filePath: '/mock/other.csv',
      accountId: 'a',
    });

    await waitFor(() =>
      expect(
        getByText(i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames })),
      ).toBeTruthy(),
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
      expect(
        getByText(i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames })),
      ).toBeTruthy(),
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
      expect(
        getByText(i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames })),
      ).toBeTruthy(),
    );
    expect(queryByTestId('statement-import-transaction-count')).toBeNull();
  });

  it('selecting a holding then pressing Import calls importStatement with the decoded text and shows the imported count', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    mockImportStatement.mockResolvedValue({
      formatId: 'monobank-csv',
      imported: 3,
      total: 4,
      skippedWrongCurrency: 0,
      skippedWrongCurrencyCodes: [],
    });

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

  // A successful Import shows a MODAL with the result text — the same
  // text `ImportOutcome` renders inline for an error.
  it('shows the import result as a modal', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    mockImportStatement.mockResolvedValue({
      formatId: 'monobank-csv',
      imported: 3,
      total: 4,
      skippedWrongCurrency: 0,
      skippedWrongCurrencyCodes: [],
    });
    setLiveData({ account: { id: 'a', name: 'My Monobank card', bankId: 'monobank' } });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );
  });

  // "Add new" holding must end up SELECTED once created, not just present
  // in the live-queried option list.
  it('navigates to HoldingForm with a returnTo, then selects the holding once holdingId arrives back', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      holdings: [
        { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
        { id: 'h2', name: 'New savings', accountId: 'a', accountName: 'Monobank' },
      ],
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    await fireEvent.press(view.getByTestId('mock-create-new-holding'));

    expect(view.navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
      accountId: 'a',
      returnTo: {
        screen: 'StatementImport',
        params: { filePath: '/mock/statement.csv', accountId: 'a' },
      },
    });

    const updatedRoute = asRouteProp<StatementImportProps['route']>('StatementImport', {
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'h2',
    });

    await act(async () => {
      view.rerender(
        <StatementImportScreen
          route={updatedRoute}
          navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
        />,
      );
    });

    await waitFor(() =>
      expect(
        within(view.getByTestId('target-holding-field')).getByText('New savings'),
      ).toBeTruthy(),
    );
  });

  // The created-holding return channel hands back whatever type the user
  // picked in the holding form, but the picker lists only a holding that keeps
  // a ledger: a ledgerless id must read as "not selected", never as a target.
  it('treats a returned ledgerless holding as not selected, so Import asks for a holding', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      holdings: [
        { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
        {
          id: 'deposit',
          name: 'New deposit',
          accountId: 'a',
          accountName: 'Monobank',
          type: 'term_deposit',
        },
      ],
    });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'deposit',
    });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());
    expect(within(view.getByTestId('target-holding-field')).queryByText('New deposit')).toBeNull();

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(view.getByText(i18n.t('statementImport.chooseHoldingError'))).toBeTruthy();
    expect(mockImportStatement).not.toHaveBeenCalled();
  });

  // The option list is a live query that can trail the navigation back, so a
  // valid new card must stay selected once its row arrives (clearing a pick
  // the options do not list YET would drop it).
  it('selects a returned holding that only reaches the option list after the route param', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    mockImportStatement.mockResolvedValue({
      formatId: 'monobank-csv',
      imported: 4,
      total: 4,
      skippedWrongCurrency: 0,
      skippedWrongCurrencyCodes: [],
    });
    setLiveData({
      holdings: [{ id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' }],
    });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'h2',
    });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());
    expect(within(view.getByTestId('target-holding-field')).queryByText('New savings')).toBeNull();

    setLiveData({
      holdings: [
        { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
        { id: 'h2', name: 'New savings', accountId: 'a', accountName: 'Monobank' },
      ],
    });
    await act(async () => {
      view.rerender(
        <StatementImportScreen
          route={asRouteProp<StatementImportProps['route']>('StatementImport', {
            filePath: '/mock/statement.csv',
            accountId: 'a',
            holdingId: 'h2',
          })}
          navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
        />,
      );
    });

    await waitFor(() =>
      expect(
        within(view.getByTestId('target-holding-field')).getByText('New savings'),
      ).toBeTruthy(),
    );

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportStatement).toHaveBeenCalledWith(expect.anything(), 'h2'));
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
    mockImportStatement.mockResolvedValue({
      formatId: 'privatbank-xlsx',
      imported: 2,
      total: 2,
      skippedWrongCurrency: 0,
      skippedWrongCurrencyCodes: [],
    });

    const { getByText, getByTestId } = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });

    await waitFor(() => expect(getByText('PrivatBank (XLSX)')).toBeTruthy());

    // Import is ALWAYS enabled (never `disabled={!canImport}`) —
    // no holding picked yet: pressing it must NOT auto-route by either card
    // hint shown above (the masked-card hint is a display suggestion only,
    // never a silent target pick), and validates on press
    // instead, showing the field's own inline error.
    expect(getByText(i18n.t('statementImport.importButton')).props.disabled).toBeFalsy();
    await fireEvent.press(getByText(i18n.t('statementImport.importButton')));
    expect(mockImportStatement).not.toHaveBeenCalled();
    expect(getByText(i18n.t('statementImport.chooseHoldingError'))).toBeTruthy();

    await fireEvent.press(getByTestId('mock-select-holding-h1'));
    await fireEvent.press(getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportStatement).toHaveBeenCalledTimes(1));
    expect(mockImportStatement).toHaveBeenCalledWith(expect.anything(), 'h1');
  });

  // A multi-currency file's preview must surface EVERY detected currency
  // BEFORE the user picks a holding, so they
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

  it('surfaces the skipped-wrong-currency count and codes after a real import excludes some rows', async () => {
    mockReadFile.mockResolvedValue('irrelevant-base64-the-mocked-detectFormat-ignores-it');
    mockImportStatement.mockResolvedValue({
      formatId: 'privatbank-xlsx',
      imported: 1,
      total: 2,
      skippedWrongCurrency: 1,
      // The result names WHICH currency was skipped.
      skippedWrongCurrencyCodes: ['USD'],
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
    expect(
      getByText(i18n.t('statementImport.skippedWrongCurrencyCodes', { currencies: 'USD' })),
    ).toBeTruthy();
  });

  // Sensebank (and the FOP CSVs) is cp1251-encoded, not UTF-8. The screen must
  // try decoding the picked file's bytes as UTF-8 first (Monobank's existing
  // path); if NO format recognizes that text, it must retry decoding the SAME
  // bytes as cp1251 before giving up.
  describe('cp1251 decode fallback (Sensebank)', () => {
    beforeEach(() => {
      sensebankDetectFormatCalls.length = 0;
    });

    it('retries with a cp1251 decode when the UTF-8 decode matches no known format, and previews the result', async () => {
      mockReadFile.mockResolvedValue(sensebankPreambleCp1251Base64);

      const { getByText, getByTestId } = await renderScreen({
        filePath: `/mock/${SENSEBANK_TRIGGER_FILE_NAME}`,
        accountId: 'a',
      });

      await waitFor(() => expect(getByText('Sensebank (CSV)')).toBeTruthy());

      // Proves the screen genuinely RETRIED — the first `detectFormat` call
      // (the UTF-8 decode of these cp1251 bytes) must NOT already be the
      // correctly decoded preamble, and at least one later call must be.
      expect(sensebankDetectFormatCalls[0]).not.toBe(SENSEBANK_DECODED_PREAMBLE);
      expect(sensebankDetectFormatCalls).toContain(SENSEBANK_DECODED_PREAMBLE);

      // The preview renders the SECOND (cp1251) pass's real match — the
      // sentinel's own canned stats — not a blank/unrecognized state.
      expect(getByTestId('statement-import-transaction-count')).toHaveTextContent('1');
      expect(getByTestId('statement-import-currency')).toHaveTextContent('UAH');
    });

    // Regression guard: the fallback must never run (or interfere) for a
    // file that already matches on the FIRST (UTF-8) pass — Monobank stays a
    // single-attempt detect, exactly as it was before this task.
    it('still detects a UTF-8 Monobank file on the first pass (no regression)', async () => {
      mockReadFile.mockResolvedValue(fixtureBase64);

      const { getByText } = await renderScreen({
        filePath: '/mock/statement.csv',
        accountId: 'a',
      });

      await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());
      // The sensebank sentinel's own call log stays untouched — proves this
      // path never goes anywhere near the cp1251 branch.
      expect(sensebankDetectFormatCalls).toHaveLength(0);
    });
  });
});

// The "Map columns manually" entry point into the generic column-mapping
// import screen, plus the auto-replace shortcut for a file that already has
// an exact saved mapping under a DIFFERENT bank than the one recognized.
describe('StatementImportScreen — column-mapping entry point', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({});
  });

  it('offers "Map columns manually" under a recognized preview, alongside the existing actions', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getByText } = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(getByText('Monobank (CSV)')).toBeTruthy());
    expect(getByText(i18n.t('statementImport.mapColumnsManually'))).toBeTruthy();
  });

  it('offers "Map columns manually" for an unrecognized file, and it navigates with filePath/accountId', async () => {
    mockReadFile.mockResolvedValue(unrelatedBase64);

    const { getByText, navigation } = await renderScreen({
      filePath: '/mock/other.csv',
      accountId: 'a',
    });

    await waitFor(() =>
      expect(getByText(i18n.t('statementImport.mapColumnsManually'))).toBeTruthy(),
    );

    await fireEvent.press(getByText(i18n.t('statementImport.mapColumnsManually')));

    expect(navigation.navigate).toHaveBeenCalledWith('ColumnMapping', {
      filePath: '/mock/other.csv',
      accountId: 'a',
    });
  });

  it('offers "Map columns manually" for a bank-mismatch file too', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const { getByText } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() =>
      expect(
        getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
      ).toBeTruthy(),
    );
    expect(getByText(i18n.t('statementImport.mapColumnsManually'))).toBeTruthy();
  });

  it('does NOT offer "Map columns manually" while the file read itself failed', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: file not found'));

    const { queryByText } = await renderScreen({
      filePath: '/mock/missing.csv',
      accountId: 'a',
    });

    await waitFor(() =>
      expect(
        queryByText(
          i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames }),
        ),
      ).toBeTruthy(),
    );
    expect(queryByText(i18n.t('statementImport.mapColumnsManually'))).toBeNull();
  });

  it('replaces the route to ColumnMapping when a bank-mismatch file has an exact saved mapping under the account’s own bank', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: {
        'bank:sensebank': {
          headerRowIndex: 0,
          decimalSeparator: '.',
          dateColumn: 0,
          dateFormat: 'DD.MM.YYYY HH:MM:SS',
          amount: { mode: 'single', column: 3 },
          descriptionColumn: 1,
          currency: { mode: 'fixed', currency: 'UAH' },
          fingerprint: headerFingerprint(fixtureHeaderRow),
          savedAt: 1_700_000_000_000,
        },
      },
    });

    const { navigation } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    // `ownsFile: true` — the auto-replace hands
    // ColumnMapping sole ownership of the file (no StatementImport route
    // left below it on the stack).
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('ColumnMapping', {
        filePath: '/mock/statement.csv',
        accountId: 'a',
        ownsFile: true,
      }),
    );
  });

  it('does not auto-replace when no exact saved mapping exists for a bank-mismatch file', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({ account: { id: 'a', bankId: 'sensebank' } });

    const { navigation, getByText } = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() =>
      expect(
        getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
      ).toBeTruthy(),
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  // The exact saved mapping to reuse across the three cases below.
  const exactSensebankMapping = {
    'bank:sensebank': {
      headerRowIndex: 0,
      decimalSeparator: '.',
      dateColumn: 0,
      dateFormat: 'DD.MM.YYYY HH:MM:SS',
      amount: { mode: 'single', column: 3 },
      descriptionColumn: 1,
      currency: { mode: 'fixed', currency: 'UAH' },
      fingerprint: headerFingerprint(fixtureHeaderRow),
      savedAt: 1_700_000_000_000,
    },
  };

  // `useLiveQuery` starts at `data: []`/`isLoading: true` and fills in
  // later — a cold-started settings query resolving AFTER the file itself
  // is decoded must still be seen by the auto-replace check the moment it
  // resolves, not treated as "no mapping exists" just because it hadn't
  // loaded yet at the instant `input` became ready.
  it('replaces the route once the still-loading settings query resolves with an exact match (cold start)', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({ account: { id: 'a', bankId: 'sensebank' }, settingsIsLoading: true });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() =>
      expect(
        view.getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
      ).toBeTruthy(),
    );
    expect(view.navigation.replace).not.toHaveBeenCalled();

    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: exactSensebankMapping,
    });

    await act(async () => {
      view.rerender(
        <StatementImportScreen
          route={asRouteProp<StatementImportProps['route']>('StatementImport', {
            filePath: '/mock/statement.csv',
            accountId: 'a',
            expectedFormatId: 'sensebank-csv',
          })}
          navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
        />,
      );
    });

    expect(view.navigation.replace).toHaveBeenCalledTimes(1);
    expect(view.navigation.replace).toHaveBeenCalledWith('ColumnMapping', {
      filePath: '/mock/statement.csv',
      accountId: 'a',
      ownsFile: true,
    });
  });

  // A mapping saved by a DIFFERENT screen (the pushed ColumnMapping screen,
  // mid-Import) notifies every mounted subscriber, including this one — once
  // both live queries have already resolved and the check has decided
  // "no match", a LATER `savedMappings` write must never re-arm it.
  it('does not auto-replace when savedMappings changes to a match AFTER the initial decision', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({ account: { id: 'a', bankId: 'sensebank' } });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() =>
      expect(
        view.getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
      ).toBeTruthy(),
    );
    expect(view.navigation.replace).not.toHaveBeenCalled();

    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: exactSensebankMapping,
    });

    await act(async () => {
      view.rerender(
        <StatementImportScreen
          route={asRouteProp<StatementImportProps['route']>('StatementImport', {
            filePath: '/mock/statement.csv',
            accountId: 'a',
            expectedFormatId: 'sensebank-csv',
          })}
          navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
        />,
      );
    });

    expect(view.navigation.replace).not.toHaveBeenCalled();
  });

  // The user pushing "Map columns manually" themselves must disable
  // auto-replace for good, even when they did it while the settings query
  // was still loading and a matching mapping only shows up afterward.
  it('does not auto-replace after a manual push, even once a still-loading settings query resolves with a match', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({ account: { id: 'a', bankId: 'sensebank' }, settingsIsLoading: true });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.mapColumnsManually'))).toBeTruthy(),
    );

    await fireEvent.press(view.getByText(i18n.t('statementImport.mapColumnsManually')));

    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: exactSensebankMapping,
    });

    await act(async () => {
      view.rerender(
        <StatementImportScreen
          route={asRouteProp<StatementImportProps['route']>('StatementImport', {
            filePath: '/mock/statement.csv',
            accountId: 'a',
            expectedFormatId: 'sensebank-csv',
          })}
          navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
        />,
      );
    });

    expect(view.navigation.replace).not.toHaveBeenCalled();
  });
});

// On Done, the sheet closes
// FIRST — popping the underlying native-stack screen while its RN Modal is
// still mid-close is a known iOS rough edge — and only navigates once the
// sheet's `onClosed` fires (`BottomSheet`'s pass-through of RN `Modal`'s own
// `onDismiss`, which only fires once the close ANIMATION has actually
// finished), not from a guessed delay.
describe('StatementImportScreen — Done closes the sheet before navigating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({});
  });

  const importSuccessfully = async (): Promise<Awaited<ReturnType<typeof renderScreen>>> => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    mockImportStatement.mockResolvedValue({
      formatId: 'monobank-csv',
      imported: 3,
      total: 4,
      skippedWrongCurrency: 0,
      skippedWrongCurrencyCodes: [],
    });
    setLiveData({ account: { id: 'a', name: 'My Monobank card', bankId: 'monobank' } });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );

    return view;
  };

  it('Done closes the sheet, but does not navigate on its own', async () => {
    const view = await importSuccessfully();

    await fireEvent.press(view.getByText(i18n.t('common.done')));

    // The sheet is closed — its content is gone (the project's own Modal
    // mock removes it the instant `visible` flips false, mirroring the
    // start of a real close transition).
    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    // No navigation yet — only `onClosed` (the sheet's real completion
    // signal) triggers it, never `onDone` itself.
    expect(view.navigation.popTo).not.toHaveBeenCalled();
    expect(view.navigation.goBack).not.toHaveBeenCalled();
  });

  it('navigates once the sheet reports onClosed, asking the account page for the import reminder offer', async () => {
    const view = await importSuccessfully();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    // `popTo`, not `navigate` — reusing the existing `AccountDetail`
    // instance.
    expect(view.navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: 'My Monobank card', reminderOffer: 'afterImport' },
      { merge: true },
    );
    expect(view.navigation.navigate).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
  });

  // Ignores a repeated close signal (e.g. a double Done tap under real
  // animation timing firing `onClosed` more than once) — navigates AT MOST
  // once.
  it('a repeated onClosed (a double Done tap) navigates once', async () => {
    const view = await importSuccessfully();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');
    expect(view.navigation.popTo).toHaveBeenCalledTimes(1);

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.popTo).toHaveBeenCalledTimes(1);
  });
});

// The local cache copy this screen's own fix
// makes is deleted once THIS screen is removed from the stack — a genuine
// unmount, not a mere push-on-top (Map Columns).
describe('StatementImportScreen — local copy cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({});
  });

  it('deletes the local cache copy on unmount (a successful import or a back-out)', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const view = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
    });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    await act(async () => {
      view.unmount();
    });

    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/statement-123.csv');
  });

  it('does NOT delete the local copy while merely pushed under Map Columns (still mounted)', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const view = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
    });

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());
    await fireEvent.press(view.getByText(i18n.t('statementImport.mapColumnsManually')));

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('does NOT delete the local copy when this screen auto-replaces itself with ColumnMapping — that screen now owns the SAME file', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: {
        'bank:sensebank': {
          headerRowIndex: 0,
          decimalSeparator: '.',
          dateColumn: 0,
          dateFormat: 'DD.MM.YYYY HH:MM:SS',
          amount: { mode: 'single', column: 3 },
          descriptionColumn: 1,
          currency: { mode: 'fixed', currency: 'UAH' },
          fingerprint: headerFingerprint(fixtureHeaderRow),
          savedAt: 1_700_000_000_000,
        },
      },
    });

    const view = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() => expect(view.navigation.replace).toHaveBeenCalled());

    view.unmount();

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  // The cleanup deletes after an await, so the assertion has to wait for the
  // unmount to settle before "never deleted" means anything.
  it('does NOT delete the local copy after auto-replacing, once the unmount has settled', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: savedSensebankMappingForFixture,
    });

    const view = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    await waitFor(() => expect(view.navigation.replace).toHaveBeenCalled());

    await act(async () => {
      view.unmount();
    });

    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

const savedSensebankMappingForFixture = {
  'bank:sensebank': {
    headerRowIndex: 0,
    decimalSeparator: '.',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'single', column: 3 },
    descriptionColumn: 1,
    currency: { mode: 'fixed', currency: 'UAH' },
    fingerprint: headerFingerprint(fixtureHeaderRow),
    savedAt: 1_700_000_000_000,
  },
};

const unrecognizedFormatMessage = (): string =>
  i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames });

describe('StatementImportScreen — what shows in each load state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    multiCardDetectedInputs.length = 0;
    setLiveData({});
  });

  it('shows only the reading message, with no footer, while the file loads, even with an expected bank', async () => {
    mockReadFile.mockReturnValue(new Promise(() => {}));

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });

    expect(mockReadFile).toHaveBeenCalledWith('/mock/statement.csv', 'base64');
    expect(view.getByText(i18n.t('statementImport.reading'))).toBeTruthy();
    expect(view.queryByText(unrecognizedFormatMessage())).toBeNull();
    expect(
      view.queryByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
    ).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importButton'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.mapColumnsManually'))).toBeNull();
    expect(view.queryByTestId('screen-footer')).toBeNull();
  });

  it('shows a clean recognized preview: no reading, unrecognized or mismatch message, no error before a press', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'monobank-csv',
    });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    expect(view.queryByText(i18n.t('statementImport.reading'))).toBeNull();
    expect(view.queryByText(unrecognizedFormatMessage())).toBeNull();
    expect(
      view.queryByText(i18n.t('statementImport.bankMismatch', { bank: 'Monobank (CSV)' })),
    ).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.chooseHoldingError'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    expect(view.getByText(i18n.t('statementImport.importButton'))).toBeTruthy();
  });

  it('shows no reading message and no Import button once the read has failed', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const view = await renderScreen({ filePath: '/mock/missing.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(unrecognizedFormatMessage())).toBeTruthy());

    expect(view.queryByText(i18n.t('statementImport.reading'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importButton'))).toBeNull();
  });

  it('offers only "Map columns manually", not Import, for a file no format recognizes', async () => {
    mockReadFile.mockResolvedValue(unrelatedBase64);

    const view = await renderScreen({ filePath: '/mock/other.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(unrecognizedFormatMessage())).toBeTruthy());

    expect(view.queryByText(i18n.t('statementImport.reading'))).toBeNull();
    expect(view.getByText(i18n.t('statementImport.mapColumnsManually'))).toBeTruthy();
    expect(view.queryByText(i18n.t('statementImport.importButton'))).toBeNull();
  });

  it('still renders the unrecognized state when the settings row has not been created yet', async () => {
    mockReadFile.mockResolvedValue(unrelatedBase64);
    setLiveData({ noSettingsRow: true });

    const view = await renderScreen({ filePath: '/mock/other.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText(unrecognizedFormatMessage())).toBeTruthy());
  });

  it('hands a spreadsheet’s pre-parsed rows, not decoded text, to format detection', async () => {
    mockReadFile.mockResolvedValue('c3ByZWFkc2hlZXQ=');
    const sheetRows = [
      ['Date', 'Amount'],
      ['01.01.2024', 10],
    ];
    mockReadSheetRowsSafely.mockResolvedValue(sheetRows);

    const view = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });
    await waitFor(() => expect(view.getByText('PrivatBank (XLSX)')).toBeTruthy());

    expect(mockReadSheetRowsSafely).toHaveBeenCalledWith('c3ByZWFkc2hlZXQ=');
    const handed = multiCardDetectedInputs.at(-1);
    expect(handed?.text).toBe('');
    expect(handed?.sheetRows).toEqual(sheetRows);
    expect(handed?.fileName).toBe(MULTI_CARD_FILE_NAME);
  });

  it('does not start reading a spreadsheet when the screen is gone before the file arrived', async () => {
    let resolveFile: (base64: string) => void = () => {};
    mockReadFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveFile = resolve;
      }),
    );

    const view = await renderScreen({
      filePath: `/mock/${MULTI_CARD_FILE_NAME}`,
      accountId: 'a',
    });
    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      resolveFile('c3ByZWFkc2hlZXQ=');
    });

    expect(mockReadSheetRowsSafely).not.toHaveBeenCalled();
  });
});

describe('StatementImportScreen — auto-replace guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({});
  });

  it('does not replace the route when the screen is not the focused one', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      account: { id: 'a', bankId: 'sensebank' },
      statementMappings: savedSensebankMappingForFixture,
    });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
      isFocused: false,
    });

    await waitFor(() =>
      expect(
        view.getByText(i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' })),
      ).toBeTruthy(),
    );
    expect(view.navigation.isFocused).toHaveBeenCalled();
    expect(view.navigation.replace).not.toHaveBeenCalled();
  });

  it('never replaces the route for a file a dedicated format recognizes, saved mapping or not', async () => {
    mockReadFile.mockResolvedValue(fixtureBase64);
    setLiveData({
      account: { id: 'a', bankId: 'monobank' },
      statementMappings: {
        'bank:monobank': {
          ...savedSensebankMappingForFixture['bank:sensebank'],
        },
      },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    expect(view.navigation.replace).not.toHaveBeenCalled();
  });
});

describe('StatementImportScreen — Import press', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({});
    mockReadFile.mockResolvedValue(fixtureBase64);
  });

  const importResult = {
    formatId: 'monobank-csv',
    imported: 3,
    total: 4,
    skippedWrongCurrency: 0,
    skippedWrongCurrencyCodes: [],
  };

  const renderPreview = async (): Promise<Awaited<ReturnType<typeof renderScreen>>> => {
    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    return view;
  };

  const importButton = (view: Awaited<ReturnType<typeof renderScreen>>) =>
    view.getByRole('button', { name: i18n.t('statementImport.importButton') });

  it('flags the missing holding on the first press, scrolls to its field, and clears the flag once one is picked', async () => {
    const view = await renderPreview();

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(view.getByText(i18n.t('statementImport.chooseHoldingError'))).toBeTruthy();
    expect(mockImportStatement).not.toHaveBeenCalled();
    expect(scrollToField).toHaveBeenCalledTimes(1);
    const [, targetRef] = (scrollToField as jest.Mock).mock.calls[0];
    expect(targetRef.current.props.children.props.testID).toBe('target-holding-field');

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(view.queryByText(i18n.t('statementImport.chooseHoldingError'))).toBeNull();
  });

  it('hands the scroll the live content height', async () => {
    const view = await renderPreview();
    await fireEvent(view.getByTestId('screen-scroll-view'), 'contentSizeChange', 320, 1234);

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect((scrollToField as jest.Mock).mock.calls[0][2]).toEqual(
      expect.objectContaining({ contentHeight: 1234 }),
    );
  });

  it('disables Import while the import runs, and releases it once the result arrives', async () => {
    let finishImport: (result: typeof importResult) => void = () => {};
    mockImportStatement.mockReturnValue(
      new Promise<typeof importResult>((resolve) => {
        finishImport = resolve;
      }),
    );
    const view = await renderPreview();
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    // Not awaited: the press only settles once the (pending) import does.
    const firstPress = fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(importButton(view)).toBeDisabled());
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
    expect(mockImportStatement).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishImport(importResult);
    });
    await firstPress;

    expect(importButton(view)).not.toBeDisabled();
    expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy();
  });

  it('alerts with the translated failure, shows no result, and lets the user retry when the import throws', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportStatement.mockRejectedValueOnce(new Error('disk full'));
    const view = await renderPreview();
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        i18n.t('statementImport.importErrorTitle'),
        i18n.t('statementImport.importErrorMessage'),
      ),
    );
    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    expect(importButton(view)).not.toBeDisabled();

    mockImportStatement.mockResolvedValue(importResult);
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );
    expect(mockImportStatement).toHaveBeenCalledTimes(2);
  });

  it('goes back, instead of popping to the account, when the account row is not loaded', async () => {
    mockImportStatement.mockResolvedValue(importResult);
    const view = await renderPreview();
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.goBack).toHaveBeenCalledTimes(1);
    expect(view.navigation.popTo).not.toHaveBeenCalled();
  });
});

describe('StatementImportScreen — the balance preview', () => {
  const balancePreview = { kind: 'stays', currency: 'UAH', minorUnits: 100_000 };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseImportBalancePreview.mockReturnValue(undefined);
    setLiveData({});
    mockReadFile.mockResolvedValue(fixtureBase64);
  });

  const renderPreview = async (): Promise<Awaited<ReturnType<typeof renderScreen>>> => {
    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    return view;
  };

  const callsWithHolding = (holdingId: string | undefined) =>
    mockUseImportBalancePreview.mock.calls.filter(
      ([statement, picked]) => statement !== undefined && picked === holdingId,
    );

  it('has no holding to ask about, and shows no line, until one is picked', async () => {
    const view = await renderPreview();

    expect(callsWithHolding(undefined).length).toBeGreaterThan(0);
    expect(callsWithHolding('h1')).toHaveLength(0);
    expect(view.queryByTestId('statement-import-balance-preview')).toBeNull();
  });

  it('asks for the balance of the parsed statement in the picked holding', async () => {
    const view = await renderPreview();

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    const [statement, holdingId] = mockUseImportBalancePreview.mock.calls.at(-1) ?? [];

    expect(holdingId).toBe('h1');
    expect(statement.formatId).toBe('monobank-csv');
    expect(statement.transactions).toHaveLength(4);
  });

  it('shows the answer under the summary once there is one', async () => {
    mockUseImportBalancePreview.mockReturnValue(balancePreview);

    const view = await renderPreview();

    expect(view.getByTestId('statement-import-balance-preview')).toHaveTextContent(
      'Balance stays at 1,000.00 ₴',
    );
  });

  it('hands the hook one statement across re-renders that change nothing it depends on', async () => {
    const view = await renderPreview();

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(new Set(callsWithHolding('h1').map(([statement]) => statement)).size).toBe(1);
  });
});

describe('StatementImportScreen — the derived format and stats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseImportBalancePreview.mockReturnValue(undefined);
    setLiveData({});
    mockReadFile.mockResolvedValue(fixtureBase64);
  });

  it('does not detect the format again on a re-render that changes nothing it depends on', async () => {
    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    const detectCallsBefore = mockDetectFormat.mock.calls.length;

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(detectCallsBefore).toBeGreaterThan(0);
    expect(mockDetectFormat).toHaveBeenCalledTimes(detectCallsBefore);
  });

  it('does not recompute the stats on a re-render that changes nothing they depend on', async () => {
    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    const statsCallsBefore = jest.mocked(previewStats).mock.calls.length;

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(statsCallsBefore).toBeGreaterThan(0);
    expect(jest.mocked(previewStats)).toHaveBeenCalledTimes(statsCallsBefore);
  });

  it('does not run the expected format detect again on such a re-render', async () => {
    const expectedFormat = statementFormats.find((format) => format.id === 'monobank-csv');
    const detectSpy = jest.spyOn(expectedFormat as StatementFormat, 'detect');

    try {
      const view = await renderScreen({
        filePath: '/mock/statement.csv',
        accountId: 'a',
        expectedFormatId: 'monobank-csv',
      });
      await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

      const detectCallsBefore = detectSpy.mock.calls.length;

      await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

      expect(detectCallsBefore).toBeGreaterThan(0);
      expect(detectSpy).toHaveBeenCalledTimes(detectCallsBefore);
    } finally {
      detectSpy.mockRestore();
    }
  });

  it('detects the format and recomputes the stats again when a different file loads', async () => {
    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());

    const detectCallsBefore = mockDetectFormat.mock.calls.length;
    const statsCallsBefore = jest.mocked(previewStats).mock.calls.length;

    mockReadFile.mockResolvedValue(Buffer.from(`${fixtureText}\n`, 'utf-8').toString('base64'));
    await view.rerender(
      <StatementImportScreen
        route={asRouteProp<StatementImportProps['route']>('StatementImport', {
          filePath: '/mock/other.csv',
          accountId: 'a',
        })}
        navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
      />,
    );
    await waitFor(() =>
      expect(jest.mocked(previewStats).mock.calls.length).toBeGreaterThan(statsCallsBefore),
    );

    // The load effect's own detect plus the screen's recognition of the new input.
    expect(mockDetectFormat.mock.calls.length - detectCallsBefore).toBeGreaterThanOrEqual(2);
  });

  it('recognizes the loaded file again against a new expected format, flipping the bank mismatch', async () => {
    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'sensebank-csv',
    });
    const mismatchText = i18n.t('statementImport.bankMismatch', { bank: 'Sensebank (CSV)' });
    await waitFor(() => expect(view.getByText(mismatchText)).toBeTruthy());

    await view.rerender(
      <StatementImportScreen
        route={asRouteProp<StatementImportProps['route']>('StatementImport', {
          filePath: '/mock/statement.csv',
          accountId: 'a',
          expectedFormatId: 'monobank-csv',
        })}
        navigation={asNavigationProp<StatementImportProps['navigation']>(view.navigation)}
      />,
    );

    await waitFor(() => expect(view.getByText('Monobank (CSV)')).toBeTruthy());
    expect(view.queryByText(mismatchText)).toBeNull();
  });
});
