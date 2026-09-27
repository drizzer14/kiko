import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { supportedFormatNames } from '@kiko/statement-import/registry';
import { headerFingerprint } from '@kiko/statement-import/column-mapping';
import type { ParsedStatement, StatementFormat } from '@kiko/statement-import/parser';

import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

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

const mockImportStatement = jest.fn();
jest.mock('@kiko/statement-import/import-statement', () => ({
  importStatement: (...args: unknown[]) => mockImportStatement(...args),
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

jest.mock('@kiko/statement-import/registry', () => {
  const actual = jest.requireActual('@kiko/statement-import/registry');

  return {
    ...actual,
    detectFormat: (input: { text: string; fileName: string }) => {
      if (input.fileName === MULTI_CARD_FILE_NAME) {
        return multiCardFormatStub;
      }

      if (input.fileName === SENSEBANK_TRIGGER_FILE_NAME) {
        sensebankDetectFormatCalls.push(input.text);

        return sensebankFormatStub.detect(input) ? sensebankFormatStub : undefined;
      }

      return actual.detectFormat(input);
    },
  };
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
}) => {
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
  holdings?: { id: string; name: string; accountId: string; accountName: string }[];
  account?: { id: string; name?: string; bankId?: string | null };
  statementMappings?: Record<string, unknown> | null;
  accountIsLoading?: boolean;
  settingsIsLoading?: boolean;
}): void => {
  const holdings = data.holdings ?? [
    { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
  ];

  mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
    if (query.__kind === 'account-by-id') {
      return {
        data: data.account ? [data.account] : [],
        isLoading: data.accountIsLoading ?? false,
      };
    }

    if (query.__kind === 'settings') {
      return {
        data: [{ statementMappings: data.statementMappings ?? null }],
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

  // Section C.2's KEY DESIGN: Sensebank (and, later, the FOP CSVs) is
  // cp1251-encoded, not UTF-8. The screen must try decoding
  // the picked file's bytes as UTF-8 first (Monobank's existing path); if NO
  // format recognizes that text, it must retry decoding the SAME bytes as
  // cp1251 before giving up.
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

  it('navigates once the sheet reports onClosed', async () => {
    const view = await importSuccessfully();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    // `popTo`, not `navigate` — reusing the existing `AccountDetail`
    // instance.
    expect(view.navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: 'My Monobank card' },
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
});
