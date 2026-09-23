import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '../../design-system/unistyles';

import { i18n } from '../../i18n';
import type { ParsedStatement, StatementFormat } from '../../statement-import/parser';
import { supportedFormatNames } from '../../statement-import/registry';
import { headerFingerprint } from '../../statement-import/column-mapping';
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
// The fixture's own real header row — used to build a saved mapping whose
// `fingerprint` genuinely matches this file (T7's auto-replace check).
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

// Phase 3 (Task 4) — the screen's cp1251 decode FALLBACK, isolated from
// `sensebank-csv.format.ts`'s own CSV-shape logic (still a throwing stub at
// this point in the task split, task-4-report.md). This sentinel format's
// `detect` checks for the CORRECTLY cp1251-decoded literal Sensebank
// preamble text — it never imports the real `sensebank-csv` module — so
// these tests prove ONLY that the screen itself retries with a cp1251 decode
// when the UTF-8 pass finds no match, not that the real format module works.
const SENSEBANK_TRIGGER_FILE_NAME = 'sensebank-decode-trigger.csv';
// The literal preamble line (section C.2) `sensebankCsvFormat.detect` will
// eventually check for too — matches `SENSEBANK_PREAMBLE` in
// `sensebank-csv.format.ts` exactly (not imported from there, kept as an
// independent literal here on purpose, so this test's pass/fail is never
// coupled to that module's own export surface).
const SENSEBANK_DECODED_PREAMBLE = 'Виписка за рахунком;;;;;;;';
// The SAME preamble line, cp1251-ENCODED then base64-encoded — exactly the
// shape `RNFS.readFile(uri, 'base64')` would hand the screen for a real
// Sensebank export. Computed via the REAL `windows-1251` library's own
// `encode()` at authoring time and verified via a roundtrip `decode()`
// (task-4-report.md); NOT derived from any decode call this test file makes
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

jest.mock('../../statement-import/registry', () => {
  const actual = jest.requireActual('../../statement-import/registry');
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

const renderScreen = async (params: {
  filePath: string;
  accountId?: string;
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
// own shapes (T7's auto-replace-to-ColumnMapping check), everything else
// (the holdings/accounts-list pair `useTargetHoldingOptions` reads) keeps
// the same single-holding default every pre-T7 test in this file relies on.
const setLiveData = (data: {
  holdings?: { id: string; name: string; accountId: string; accountName: string }[];
  account?: { id: string; bankId?: string | null };
  statementMappings?: Record<string, unknown> | null;
}): void => {
  const holdings = data.holdings ?? [
    { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
  ];

  mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
    if (query.__kind === 'account-by-id') {
      return { data: data.account ? [data.account] : [] };
    }

    if (query.__kind === 'settings') {
      return { data: [{ statementMappings: data.statementMappings ?? null }] };
    }

    return { data: holdings };
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
    // "Choose a holding" is now a SELECT FIELD (device-feedback-round-F1,
    // item 2) — its caption AND its unselected placeholder value both show
    // this text, so two matches are expected; the field itself is asserted
    // by testID.
    expect(getByTestId('target-holding-field')).toBeTruthy();
  });

  // F2 fix regression guard: `account-detail.screen.tsx` resolves this
  // route's `expectedFormatId` via `statementFormatIdForBank(account.bankId)`,
  // which is `undefined` for a bank-less Bank account (`bankId: null` — a
  // valid, tested state the account-form edit picker can now return an
  // account to). With no `expectedFormatId` at all this screen must still
  // fall back to the multi-format `detectFormat` auto-detect AND still offer
  // the "Map columns manually" escape hatch, exactly as it does today for the
  // Share Extension entry point (which also carries no `expectedFormatId`).
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

  // Phase 3 (Task 4), section C.2's KEY DESIGN: Sensebank (and, later, Phase
  // 4's FOP CSVs) is cp1251-encoded, not UTF-8. The screen must try decoding
  // the picked file's bytes as UTF-8 first (Monobank's existing path); if NO
  // format recognizes that text, it must retry decoding the SAME bytes as
  // cp1251 before giving up.
  describe('cp1251 decode fallback (Sensebank, section C.2)', () => {
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

// T7: the "Map columns manually" entry point into the generic column-mapping
// import screen, plus the auto-replace shortcut for a file that already has
// an exact saved mapping under a DIFFERENT bank than the one recognized.
describe('StatementImportScreen — column-mapping entry point (T7)', () => {
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

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('ColumnMapping', {
        filePath: '/mock/statement.csv',
        accountId: 'a',
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
});
