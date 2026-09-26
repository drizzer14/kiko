import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '../../design-system/unistyles';
import '../../i18n';

import { i18n } from '../../i18n';
import { headerFingerprint } from '../../statement-import/column-mapping';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import ColumnMappingScreen from './column-mapping.screen';

const monobankFixtureText = readFileSync(
  path.join(
    __dirname,
    '../../statement-import/formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv',
  ),
  'utf-8',
);
const monobankFixtureBase64 = Buffer.from(monobankFixtureText, 'utf-8').toString('base64');
const monobankHeaderRow = monobankFixtureText.split('\n')[0].split(',');

// Raw file BYTES (cp1251-encoded on disk), base64-encoded — exactly the shape
// `RNFS.readFile(uri, 'base64')` hands the screen for a real pick, unlike
// `decodeStatementText`'s already-decoded TEXT the parity tests use.
const sensebankFixtureBase64 = readFileSync(
  path.join(
    __dirname,
    '../../statement-import/formats/sensebank-csv/__fixtures__/uabean-sensebank-sample.csv',
  ),
).toString('base64');

// A header row with NO data rows below it — the exact shape a header-only
// export, or a saved header row picked at the very LAST line, leaves the
// screen with an empty `dataRows` either way.
const headerOnlyCsvBase64 = Buffer.from('Date,Description,Amount\n', 'utf-8').toString('base64');

// Real data rows, but the mapped CURRENCY column itself is blank in every
// one of them — unlike `headerOnlyCsvBase64` above, this file has content
// to read; only the one column is empty.
const blankCurrencyColumnCsvBase64 = Buffer.from(
  'Date,Description,Amount,Currency\n01.01.2024,Coffee,10,\n02.01.2024,Tea,20,\n',
  'utf-8',
).toString('base64');

const mockReadFile = jest.fn();
const mockUnlink = jest.fn();
jest.mock('react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  CachesDirectoryPath: '/mock/caches',
}));

const mockImportParsedStatement = jest.fn();
jest.mock('../../statement-import/import-statement', () => ({
  importParsedStatement: (...args: unknown[]) => mockImportParsedStatement(...args),
}));

const mockSaveStatementMapping = jest.fn();
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ __kind: 'settings', toSQL: () => ({ sql: '', params: [] }) }),
    saveStatementMapping: (...args: unknown[]) => mockSaveStatementMapping(...args),
  },
}));

const mockUseLiveQuery = jest.fn();
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      __kind: 'holdings',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    allQuery: () => ({ __kind: 'holdings', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({
      __kind: 'accounts',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    listQuery: () => ({ __kind: 'accounts', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

// The target-holding picker has its own dedicated test file — mocked here to
// a minimal stand-in exposing one `onSelect` trigger per holding, mirroring
// `statement-import.screen.test.tsx`'s own precedent.
jest.mock('../../design-system/components/target-holding-sheet', () => {
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

type Account = { id: string; name: string; kind: string; bankId?: string | null };
type Holding = { id: string; name: string; accountId: string; currency: string };
type StatementMappings = Record<string, unknown>;

const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  statementMappings?: StatementMappings;
}): void => {
  mockUseLiveQuery.mockImplementation((_query: { __kind?: string }, tables: string[]) => {
    if (tables[0] === 'holdings') {
      return { data: data.holdings ?? [] };
    }

    if (tables[0] === 'settings') {
      return { data: [{ baseCurrency: 'UAH', statementMappings: data.statementMappings ?? null }] };
    }

    return { data: data.accounts ?? [] };
  });
};

type ColumnMappingProps = ComponentProps<typeof ColumnMappingScreen>;

const renderScreen = async (params: {
  filePath: string;
  accountId: string;
  holdingId?: string;
  ownsFile?: boolean;
}) => {
  const navigation = navigationSpy();
  const route = asRouteProp<ColumnMappingProps['route']>('ColumnMapping', params);
  const view = await render(
    <ColumnMappingScreen
      route={route}
      navigation={asNavigationProp<ColumnMappingProps['navigation']>(navigation)}
    />,
  );

  return { ...view, navigation };
};

const monobankAccount: Account = { id: 'a', name: 'Monobank', kind: 'bank', bankId: 'monobank' };
const monobankHolding: Holding = { id: 'h1', name: 'Black card', accountId: 'a', currency: 'UAH' };

// The saved Monobank mapping fixture the exact-match/prefill tests share
// — an optional `balanceColumn` lets the Balance-field test add its own
// extra property without hand-duplicating every other one (jscpd).
const savedMonobankMapping = (overrides: { balanceColumn?: number } = {}) => ({
  headerRowIndex: 0,
  decimalSeparator: '.' as const,
  dateColumn: 0,
  dateFormat: 'DD.MM.YYYY HH:MM:SS' as const,
  amount: { mode: 'single' as const, column: 3 },
  descriptionColumn: 1,
  currency: { mode: 'fixed' as const, currency: 'UAH' as const },
  fingerprint: headerFingerprint(monobankHeaderRow),
  savedAt: 1_700_000_000_000,
  ...overrides,
});

// The default successful `importParsedStatement` resolution — a clean
// 4-of-4 Monobank import with nothing skipped — shared by every test that
// only cares that Import SUCCEEDED, not its exact numbers (jscpd).
const mockDefaultImportSuccess = (): void => {
  mockImportParsedStatement.mockResolvedValue({
    formatId: 'column-mapping',
    imported: 4,
    total: 4,
    skippedWrongCurrency: 0,
    skippedWrongCurrencyCodes: [],
  });
};

// `renderScreen` for the standard Monobank fixture path, then waits for the
// raw preview to resolve — the "render and wait for the file to load" pair
// almost every test in this file opens with (jscpd).
const renderMonobankScreen = async (
  params: Parameters<typeof renderScreen>[0] = { filePath: '/mock/statement.csv', accountId: 'a' },
): ReturnType<typeof renderScreen> => {
  const view = await renderScreen(params);
  await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

  return view;
};

// The date/date-format/description trio shared by EVERY test that needs some
// (but not necessarily every) Monobank column picked — factored out so a
// still-incomplete-mapping test (no amount column mapped, say) shares
// this exact sequence with `mapMonobankColumns` below instead of a
// hand-copied near-duplicate (jscpd). `dateFormatId` defaults to the real
// Monobank format; a test that deliberately picks a MISMATCHING format
// (to force every row's own date check to fail) passes its own instead.
const mapDateFormatAndDescription = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
  dateFormatId = 'DD.MM.YYYY HH:MM:SS',
): Promise<void> => {
  await fireEvent.press(view.getByTestId('column-mapping-date-column'));
  await fireEvent.press(view.getByTestId('column-mapping-date-column-option-0'));

  await fireEvent.press(view.getByTestId('column-mapping-date-format'));
  await fireEvent.press(view.getByTestId(`column-mapping-date-format-option-${dateFormatId}`));

  await fireEvent.press(view.getByTestId('column-mapping-description-column'));
  await fireEvent.press(view.getByTestId('column-mapping-description-column-option-1'));
};

// `mapDateFormatAndDescription` above, plus the amount column — the full
// date/format/description/amount quartet every "column X, not currency" test
// below needs, only the date format and amount column index actually
// varying between them (jscpd).
const mapDateFormatDescriptionAndAmount = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
  params: { dateFormatId: string; amountColumn: number },
): Promise<void> => {
  await mapDateFormatAndDescription(view, params.dateFormatId);

  await fireEvent.press(view.getByTestId('column-mapping-amount-column'));
  await fireEvent.press(
    view.getByTestId(`column-mapping-amount-column-option-${params.amountColumn}`),
  );
};

// Switches the currency field to column mode and picks the given column —
// shared by every test that maps a currency COLUMN instead of using the
// fixed-currency default (jscpd).
const switchToColumnCurrencyMode = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
  columnIndex: number,
): Promise<void> => {
  await fireEvent.press(
    within(view.getByTestId('column-mapping-currency-mode')).getByText(
      i18n.t('columnMapping.currencyColumn'),
    ),
  );
  await fireEvent.press(view.getByTestId('column-mapping-currency-column'));
  await fireEvent.press(view.getByTestId(`column-mapping-currency-column-option-${columnIndex}`));
};

// Drives the screen through the exact Monobank mapping: header row 0
// (already the auto-guess), date column 0 + 'DD.MM.YYYY HH:MM:SS', amount
// column 3 (single mode, the default), description column 1 — fixed UAH
// currency (the default, matching the seeded holding's own currency).
const mapMonobankColumns = async (view: Awaited<ReturnType<typeof renderScreen>>): Promise<void> =>
  mapDateFormatDescriptionAndAmount(view, {
    dateFormatId: 'DD.MM.YYYY HH:MM:SS',
    amountColumn: 3,
  });

// Every field required for a Monobank import: the columns above, plus
// picking the one seeded holding — shared by every test that goes on to
// press Import, so the "map, then pick holding h1" pair is written once.
const mapMonobankColumnsAndSelectHolding = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
  holdingId = 'h1',
): Promise<void> => {
  await mapMonobankColumns(view);
  await fireEvent.press(view.getByTestId(`mock-select-holding-${holdingId}`));
};

// Renders and maps the Monobank fixture, waits for the 4-transaction
// preview, then presses Import and waits for the resulting call — the setup
// shared by every test that only differs in what it reads off the resulting
// transactions/mock calls afterward (jscpd).
const importMappedMonobankStatement = async (): Promise<
  Awaited<ReturnType<typeof renderScreen>>
> => {
  mockReadFile.mockResolvedValue(monobankFixtureBase64);
  mockDefaultImportSuccess();

  const view = await renderMonobankScreen();
  await mapMonobankColumnsAndSelectHolding(view);
  await waitFor(() =>
    expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
  );

  await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
  await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));

  return view;
};

// The same setup, stopping once the import result MODAL appears instead of
// asserting on the mock call directly — shared by the "shows result" test
// and the Done/dismiss describe block below (jscpd).
const renderMonobankImportSuccess = async (): Promise<Awaited<ReturnType<typeof renderScreen>>> => {
  mockReadFile.mockResolvedValue(monobankFixtureBase64);
  mockDefaultImportSuccess();

  const view = await renderMonobankScreen();
  await mapMonobankColumnsAndSelectHolding(view);
  await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

  await waitFor(() =>
    expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
  );

  return view;
};

// `headerOnlyCsvBase64`'s render + the date/format/description/amount
// mapping shared by both header-only-CSV tests below — only the currency
// mode differs between them (jscpd).
const renderHeaderOnlyScreenMapped = async (): Promise<
  Awaited<ReturnType<typeof renderScreen>>
> => {
  mockReadFile.mockResolvedValue(headerOnlyCsvBase64);

  const view = await renderScreen({ filePath: '/mock/header-only.csv', accountId: 'a' });
  await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

  await mapDateFormatDescriptionAndAmount(view, {
    dateFormatId: 'DD.MM.YYYY HH:MM:SS',
    amountColumn: 2,
  });

  return view;
};

describe('ColumnMappingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('maps the Monobank fixture with the resolved column mapping and shows 4 transactions', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    await mapMonobankColumns(view);

    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );
  });

  // The screen body no longer duplicates the native stack header's own
  // title — the header (`accounts.stack.tsx`'s `title:
  // t('columnMapping.title')`) is not itself rendered by this component
  // under test (it lives in the navigator), so this pins that the
  // screen's OWN body renders that exact string ZERO times.
  it('does not render a second in-body title duplicating the screen header', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.queryByText(i18n.t('columnMapping.title'))).toBeNull();
  });

  // Every section on this screen shows its own heading.
  it('shows a heading for every section', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.getByText(i18n.t('columnMapping.sectionFileFormat'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionDates'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionAmount'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionCurrency'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionDetails'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.result'))).toBeTruthy();
  });

  // The Result block's generic incomplete hint shows as soon as the screen
  // loads (nothing is mapped yet) and disappears once every required column
  // IS mapped — this is the ONE screen-level assertion that the
  // `mappingIncomplete` wiring actually reaches `MappingResult`.
  it('shows the incomplete hint while a required column is unmapped, then hides it once mapping completes', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.getByText(i18n.t('columnMapping.incomplete'))).toBeTruthy();

    await mapMonobankColumns(view);

    expect(view.queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
  });

  // The date-format picker shows a worked example ("31.12.2026
  // 23:59:59") instead of the raw preset id — meaningless to a user who
  // doesn't already know date-format notation.
  it('shows a worked example date, not the raw preset id, in the date-format picker', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    await fireEvent.press(view.getByTestId('column-mapping-date-format'));

    expect(view.getByText('31.12.2026 23:59:59')).toBeTruthy();
    expect(view.queryByText('DD.MM.YYYY HH:MM:SS')).toBeNull();

    await fireEvent.press(
      view.getByTestId('column-mapping-date-format-option-DD.MM.YYYY HH:MM:SS'),
    );

    // The field's own displayed value is the SAME example text once picked.
    expect(
      within(view.getByTestId('column-mapping-date-format')).getByText('31.12.2026 23:59:59'),
    ).toBeTruthy();
  });

  // Same "Add new" holding return channel as
  // `statement-import.screen.test.tsx` — see that test file's matching case
  // for the full explanation.
  it('navigates to HoldingForm with a returnTo, then selects the holding once holdingId arrives back', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [
        monobankHolding,
        { id: 'h2', name: 'New savings', accountId: 'a', currency: 'UAH' },
      ],
    });

    const view = await renderMonobankScreen();

    await fireEvent.press(view.getByTestId('mock-create-new-holding'));

    expect(view.navigation.navigate).toHaveBeenCalledWith('HoldingForm', {
      accountId: 'a',
      returnTo: {
        screen: 'ColumnMapping',
        params: { filePath: '/mock/statement.csv', accountId: 'a' },
      },
    });

    const updatedRoute = asRouteProp<ColumnMappingProps['route']>('ColumnMapping', {
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'h2',
    });

    await act(async () => {
      view.rerender(
        <ColumnMappingScreen
          route={updatedRoute}
          navigation={asNavigationProp<ColumnMappingProps['navigation']>(view.navigation)}
        />,
      );
    });

    await waitFor(() =>
      expect(
        within(view.getByTestId('target-holding-field')).getByText('New savings'),
      ).toBeTruthy(),
    );
  });

  // A holding already chosen on the statement-import preview
  // is passed through as `holdingId` and pre-fills this screen's own
  // target-holding field, instead of asking again.
  it('pre-fills the target-holding field from a holdingId carried over from the preview', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [
        monobankHolding,
        { id: 'h2', name: 'Savings jar', accountId: 'a', currency: 'UAH' },
      ],
    });

    const view = await renderScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'h2',
    });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    expect(within(view.getByTestId('target-holding-field')).getByText('Savings jar')).toBeTruthy();
  });

  // The holding field carries the same required marker every
  // other required field on this screen already shows — date, date format,
  // the single-mode amount column, and description already mark 4; the
  // holding field adds a 5th.
  it('marks the target-holding field as required, alongside the screen’s existing required fields', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.getAllByText('*', { includeHiddenElements: true })).toHaveLength(5);
  });

  it('switching the decimal separator changes the parsed result', async () => {
    const view = await importMappedMonobankStatement();
    const dotAmounts = mockImportParsedStatement.mock.calls[0][0].transactions.map(
      (transaction: { amountMinorUnits: number }) => transaction.amountMinorUnits,
    );

    // Monobank's own amounts are plain '.'-decimal numbers (e.g. "-100.00")
    // — forcing the WRONG decimal separator (',') doesn't throw (every cell
    // still parses to SOME finite number), it silently
    // mangles the magnitude instead (`123.45` read with ',' becomes
    // `12345`), which is exactly what this test proves changed.
    await fireEvent.press(
      within(view.getByTestId('column-mapping-decimal-separator')).getByText(','),
    );
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
    await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(2));
    const commaAmounts = mockImportParsedStatement.mock.calls[1][0].transactions.map(
      (transaction: { amountMinorUnits: number }) => transaction.amountMinorUnits,
    );

    expect(commaAmounts).not.toEqual(dotAmounts);
  });

  // Import is ALWAYS enabled (never `disabled={!canImport}`) — pressing it
  // with no amount column mapped validates on press instead, showing the
  // field's own inline error rather than a silently inert button.
  it('Import stays enabled with no amount column mapped, but shows the field error and does not import', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    await mapDateFormatAndDescription(view);
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(view.getByText(i18n.t('statementImport.importButton')).props.disabled).toBeFalsy();
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(mockImportParsedStatement).not.toHaveBeenCalled();
    expect(view.getByText(i18n.t('columnMapping.amountColumnError'))).toBeTruthy();
  });

  // A currency column with genuinely resolvable ISO codes ("Валюта" =
  // UAH/EUR/UAH/UAH) must never be blamed when the REAL problem is an
  // unrelated field — here, a date format that matches none of the
  // fixture's actual date cells. The real per-row date errors show
  // instead, and no currency error appears anywhere on the screen.
  it('shows the real per-row date errors, never a currency error, when every row fails on an unrelated date-format mismatch', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    // 'YYYY-MM-DD' matches none of the fixture's own 'DD.MM.YYYY HH:MM:SS' cells.
    await mapDateFormatDescriptionAndAmount(view, {
      dateFormatId: 'YYYY-MM-DD',
      amountColumn: 3,
    });
    // Column 5 ("Валюта") — every row's own cell is a real ISO code.
    await switchToColumnCurrencyMode(view, 5);

    await waitFor(() =>
      expect(view.queryAllByTestId(/^column-mapping-row-error-/).length).toBeGreaterThan(0),
    );
    expect(
      view.getByText(
        i18n.t('columnMapping.rowError.date', { row: 2, value: '01.04.2022 05:27:35' }),
      ),
    ).toBeTruthy();
    expect(view.queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
  });

  // Every required field is mapped and the mapping applies without
  // throwing, but zero rows survive their own date-format check — Import
  // press must surface SOMETHING (not silently do nothing), and the
  // message only appears after that press, never before.
  it('shows the noRowsResolvedError message on Import press when every row fails its own date check, and not before', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    await mapDateFormatDescriptionAndAmount(view, {
      dateFormatId: 'YYYY-MM-DD',
      amountColumn: 3,
    });
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(view.queryByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeNull();

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(mockImportParsedStatement).not.toHaveBeenCalled();
    expect(view.getByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeTruthy();
  });

  // A header-only CSV (only the header row, zero data rows) leaves BOTH
  // `transactions` and `rowErrors` empty — there is nothing to blame on a
  // per-row basis, but there is also nothing to import, so Import press must
  // still surface the noRowsResolvedError rather than do nothing at all.
  it('shows the noRowsResolvedError for a header-only CSV, fixed-currency mode', async () => {
    const view = await renderHeaderOnlyScreenMapped();

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(mockImportParsedStatement).not.toHaveBeenCalled();
    expect(view.getByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeTruthy();
  });

  // The SAME header-only CSV in COLUMN currency mode makes
  // `applyColumnMapping` throw (its own currency column has no data cells to
  // scan at all) — that is "there is no data to read", not "the codes in
  // this column aren't recognized", so the screen must show the no-rows
  // error, never the currency-unresolved one.
  it('shows the noRowsResolvedError, not a currency-unresolved error, for a header-only CSV in column-currency mode', async () => {
    const view = await renderHeaderOnlyScreenMapped();

    await switchToColumnCurrencyMode(view, 0);
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(mockImportParsedStatement).not.toHaveBeenCalled();
    expect(view.queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
    expect(view.getByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeTruthy();
  });

  // A file WITH data rows, where only the mapped currency column happens to
  // be blank, is NOT the same as a header-only file — there is real content
  // to import, so the currency field keeps its own "not recognized" error
  // instead of the Result block's generic no-rows one.
  it('keeps the currency-field error, not the noRowsResolvedError, for a blank currency column in a file WITH data rows', async () => {
    mockReadFile.mockResolvedValue(blankCurrencyColumnCsvBase64);

    const view = await renderScreen({ filePath: '/mock/blank-currency.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    await mapDateFormatDescriptionAndAmount(view, { dateFormatId: 'DD.MM.YYYY', amountColumn: 2 });
    await switchToColumnCurrencyMode(view, 3);
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(mockImportParsedStatement).not.toHaveBeenCalled();
    expect(view.getByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeTruthy();
    expect(view.queryByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeNull();
  });

  // A genuinely unresolvable currency column (every cell fails to resolve to
  // a known code) shows its error in exactly ONE place — the currency field
  // itself, only after the first Import press — never a second copy in the
  // Result block, and never before the press. Nor does the Result block show
  // its OWN generic "choose the date, amount, description columns" hint —
  // every OTHER required column IS mapped here, so that hint would misname
  // the actual problem.
  it('shows the currency-unresolved error only on the field, only after a press, never twice', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    await mapMonobankColumns(view);
    // Column 2 (MCC) — numeric merchant codes, never a currency code.
    await switchToColumnCurrencyMode(view, 2);
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(view.queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
    expect(view.queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(mockImportParsedStatement).not.toHaveBeenCalled();
    expect(view.getAllByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toHaveLength(
      1,
    );
    expect(view.queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
  });

  // A successful Import shows a MODAL with the result text.
  it('shows the import result as a modal', async () => {
    const view = await renderMonobankImportSuccess();

    expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy();
  });

  it('imports then saves the confirmed mapping under bank:<bankId>', async () => {
    await importMappedMonobankStatement();

    expect(mockImportParsedStatement).toHaveBeenCalledWith(
      expect.objectContaining({ formatId: 'column-mapping' }),
      'h1',
    );

    await waitFor(() => expect(mockSaveStatementMapping).toHaveBeenCalledTimes(1));
    const [key, savedMapping] = mockSaveStatementMapping.mock.calls[0];
    expect(key).toBe('bank:monobank');
    expect(savedMapping).toEqual(
      expect.objectContaining({
        headerRowIndex: 0,
        dateColumn: 0,
        dateFormat: 'DD.MM.YYYY HH:MM:SS',
        amount: { mode: 'single', column: 3 },
        descriptionColumn: 1,
      }),
    );
  });

  it('pre-fills an exact saved mapping, shows the caption, and still requires the Import tap', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockDefaultImportSuccess();
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: { 'bank:monobank': savedMonobankMapping() },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    // The pre-filled preview must NOT have imported anything on its own —
    // the user still has to pick a holding and tap Import.
    expect(mockImportParsedStatement).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));
  });

  // The optional Balance column role renders as a
  // field, and a saved mapping's `balanceColumn` pre-fills it — same
  // pattern as the exact-saved-mapping test above, plus this one field.
  it('renders the Balance field and pre-fills it from a saved mapping', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: { 'bank:monobank': savedMonobankMapping({ balanceColumn: 9 }) },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());

    expect(view.getByText(i18n.t('columnMapping.balanceColumn'))).toBeTruthy();
    expect(
      within(view.getByTestId('column-mapping-balance-column')).getByText(
        monobankHeaderRow[9].trim(),
      ),
    ).toBeTruthy();
  });

  it('pre-fills a saved mapping with an unrecognized amount/currency mode without throwing', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: {
        'bank:monobank': {
          ...savedMonobankMapping(),
          amount: { mode: 'unrecognized', column: 3 },
          currency: { mode: 'unrecognized', currency: 'UAH' },
        },
      },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    // The pre-fill effect must still complete (setting `savedApplied`)
    // instead of throwing before reaching its later setters.
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());
  });

  describe('Sensebank cp1251 decoding', () => {
    const mapSensebankColumns = async (
      view: Awaited<ReturnType<typeof renderScreen>>,
    ): Promise<void> => {
      await fireEvent.press(view.getByTestId('raw-preview-row-5'));

      await fireEvent.press(within(view.getByTestId('column-mapping-delimiter')).getByText(';'));
      await fireEvent.press(
        within(view.getByTestId('column-mapping-decimal-separator')).getByText(','),
      );

      await fireEvent.press(view.getByTestId('column-mapping-date-column'));
      await fireEvent.press(view.getByTestId('column-mapping-date-column-option-0'));
      await fireEvent.press(view.getByTestId('column-mapping-date-format'));
      await fireEvent.press(view.getByTestId('column-mapping-date-format-option-DD.MM.YY HH:MM'));

      await fireEvent.press(
        within(view.getByTestId('column-mapping-amount-mode')).getByText(
          i18n.t('columnMapping.amountModeDebitCredit'),
        ),
      );
      await fireEvent.press(view.getByTestId('column-mapping-debit-column'));
      await fireEvent.press(view.getByTestId('column-mapping-debit-column-option-6'));
      await fireEvent.press(view.getByTestId('column-mapping-credit-column'));
      await fireEvent.press(view.getByTestId('column-mapping-credit-column-option-7'));

      await fireEvent.press(view.getByTestId('column-mapping-description-column'));
      await fireEvent.press(view.getByTestId('column-mapping-description-column-option-3'));
    };

    it('shows row errors with UTF-8 selected, and switching to Windows-1251 sharply reduces them', async () => {
      mockReadFile.mockResolvedValue(sensebankFixtureBase64);
      setLiveData({
        accounts: [{ id: 'a', name: 'Sensebank', kind: 'bank', bankId: 'sensebank' }],
        holdings: [monobankHolding],
      });

      const view = await renderScreen({ filePath: '/mock/sensebank.csv', accountId: 'a' });
      await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

      await mapSensebankColumns(view);

      const utf8RowErrorCount = await waitFor(() => {
        const errors = view.queryAllByTestId(/^column-mapping-row-error-/);
        expect(errors.length).toBeGreaterThan(2);

        return errors.length;
      });

      await fireEvent.press(
        within(view.getByTestId('column-mapping-encoding')).getByText('Windows-1251'),
      );

      await waitFor(() => {
        const errors = view.queryAllByTestId(/^column-mapping-row-error-/);
        expect(errors.length).toBeLessThan(utf8RowErrorCount);
        expect(errors.length).toBe(2);
      });
    });
  });
});

// On Done, the sheet
// closes FIRST, and only navigates once the sheet's `onClosed` fires
// (`BottomSheet`'s pass-through of RN `Modal`'s own `onDismiss`) — see the
// matching describe block in statement-import.screen.test.tsx for the full
// rationale.
describe('ColumnMappingScreen — Done closes the sheet before navigating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('Done closes the sheet, but does not navigate on its own', async () => {
    const view = await renderMonobankImportSuccess();

    await fireEvent.press(view.getByText(i18n.t('common.done')));

    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    expect(view.navigation.popTo).not.toHaveBeenCalled();
    expect(view.navigation.goBack).not.toHaveBeenCalled();
  });

  it('navigates once the sheet reports onClosed', async () => {
    const view = await renderMonobankImportSuccess();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: 'Monobank' },
      { merge: true },
    );
    expect(view.navigation.navigate).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
  });

  it('a repeated onClosed (a double Done tap) navigates once', async () => {
    const view = await renderMonobankImportSuccess();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');
    expect(view.navigation.popTo).toHaveBeenCalledTimes(1);

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.popTo).toHaveBeenCalledTimes(1);
  });
});

// The local cache copy this screen's own fix makes is deleted once this
// screen is removed from the stack, but ONLY when this screen OWNS the
// file (ownsFile, set exclusively by StatementImportScreen's auto-replace).
// Reached instead by "Map columns manually" (a PUSH), StatementImport
// stays mounted underneath and still owns the file — deleting it here on a
// plain Back would strand that still-reachable preview.
describe('ColumnMappingScreen — local copy cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('deletes the local cache copy on unmount when it OWNS the file (the auto-replace-to-ColumnMapping path)', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
      ownsFile: true,
    });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    await act(async () => {
      view.unmount();
    });

    expect(mockUnlink).toHaveBeenCalledWith('/mock/caches/statement-123.csv');
  });

  // The "Map columns manually" push — no ownsFile — must NOT delete on
  // Back, since the preview screen underneath still owns and reads the
  // SAME file: "preview -> Map columns -> Back -> Map columns again" must
  // still work.
  it('does NOT delete the local cache copy on unmount when it does NOT own the file (pushed from the preview)', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
    });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    await act(async () => {
      view.unmount();
    });

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  // preview -> Map columns -> Back -> the file
  // survives -> Map columns again still reads it successfully. Simulated
  // here as a non-owning ColumnMapping instance unmounting (the Back),
  // then a FRESH instance for the SAME filePath mounting again (the second
  // "Map columns manually" tap) and reading the file without error.
  it('preview -> Map columns -> Back -> Map columns again still reads the SAME file successfully', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const first = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
    });
    await waitFor(() => expect(first.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    await act(async () => {
      first.unmount();
    });

    expect(mockUnlink).not.toHaveBeenCalled();

    const second = await renderScreen({
      filePath: '/mock/caches/statement-123.csv',
      accountId: 'a',
    });

    await waitFor(() => expect(second.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());
  });
});
