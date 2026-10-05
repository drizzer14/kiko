import path from 'node:path';
import { Alert } from 'react-native';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { scrollToField } from '@kiko/design-system/scroll-to-field';
import { supportedFormatNames } from '@kiko/statement-import/registry';
import { headerFingerprint } from '@kiko/statement-import/column-mapping';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

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

const mockReadSheetRowsSafely = jest.fn();
jest.mock('@kiko/statement-import/read-statement-file', () => ({
  ...jest.requireActual('@kiko/statement-import/read-statement-file'),
  readSheetRowsSafely: (...args: unknown[]) => mockReadSheetRowsSafely(...args),
}));

jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const mockImportParsedStatement = jest.fn();
jest.mock('@kiko/statement-import/import-statement', () => ({
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
jest.mock('@kiko/db/use-live-query', () => ({
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

type Account = { id: string; name: string; kind: string; bankId?: string | null };
type Holding = { id: string; name: string; accountId: string; currency: string; type?: string };
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

    return { data: tables[0] === 'accounts' ? (data.accounts ?? []) : [] };
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
const savedMonobankMapping = (overrides: { balanceColumn?: number; timeZone?: string } = {}) => ({
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

  // The created-holding return channel hands back whatever type the user
  // picked in the holding form, but the picker lists only a holding that keeps
  // a ledger: a ledgerless id must read as "not selected", never as a target.
  it('treats a returned ledgerless holding as not selected, so Import asks for a holding', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [
        monobankHolding,
        {
          id: 'deposit',
          name: 'New deposit',
          accountId: 'a',
          currency: 'UAH',
          type: 'term_deposit',
        },
      ],
    });

    const view = await renderMonobankScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'deposit',
    });
    await mapMonobankColumns(view);

    expect(within(view.getByTestId('target-holding-field')).queryByText('New deposit')).toBeNull();

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    expect(view.getByText(i18n.t('statementImport.chooseHoldingError'))).toBeTruthy();
    expect(mockImportParsedStatement).not.toHaveBeenCalled();
  });

  // The option list is a live query that can trail the navigation back, so a
  // valid new card must stay selected once its row arrives (clearing a pick
  // the options do not list YET would drop it).
  it('selects a returned holding that only reaches the option list after the route param', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockDefaultImportSuccess();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });

    const view = await renderMonobankScreen({
      filePath: '/mock/statement.csv',
      accountId: 'a',
      holdingId: 'h2',
    });

    expect(within(view.getByTestId('target-holding-field')).queryByText('New savings')).toBeNull();

    setLiveData({
      accounts: [monobankAccount],
      holdings: [
        monobankHolding,
        { id: 'h2', name: 'New savings', accountId: 'a', currency: 'UAH' },
      ],
    });
    await act(async () => {
      view.rerender(
        <ColumnMappingScreen
          route={asRouteProp<ColumnMappingProps['route']>('ColumnMapping', {
            filePath: '/mock/statement.csv',
            accountId: 'a',
            holdingId: 'h2',
          })}
          navigation={asNavigationProp<ColumnMappingProps['navigation']>(view.navigation)}
        />,
      );
    });

    await waitFor(() =>
      expect(
        within(view.getByTestId('target-holding-field')).getByText('New savings'),
      ).toBeTruthy(),
    );

    await mapMonobankColumns(view);
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(mockImportParsedStatement).toHaveBeenCalledWith(expect.anything(), 'h2'),
    );
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

  // The mapping is a convenience for next time; the import itself already
  // committed, so a failed save must not report the import as failed.
  it('keeps a successful import shown as done when saving the mapping fails', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    mockSaveStatementMapping.mockRejectedValue(new Error('disk full'));

    const view = await renderMonobankImportSuccess();

    await waitFor(() => expect(mockSaveStatementMapping).toHaveBeenCalledTimes(1));
    expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
  });

  describe('the fixed currency', () => {
    const usdHolding: Holding = { id: 'h2', name: 'Dollar card', accountId: 'a', currency: 'USD' };
    const importedCurrency = (): string =>
      mockImportParsedStatement.mock.calls[0][0].transactions[0].currency;
    const importInto = async (
      view: Awaited<ReturnType<typeof renderScreen>>,
      holdingId: string,
    ): Promise<void> => {
      await fireEvent.press(view.getByTestId(`mock-select-holding-${holdingId}`));
      await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
      await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));
    };

    beforeEach(() => {
      mockReadFile.mockResolvedValue(monobankFixtureBase64);
      mockDefaultImportSuccess();
    });

    it('follows the target holding, not the account’s first holding', async () => {
      setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding, usdHolding] });
      const view = await renderMonobankScreen();
      await mapMonobankColumns(view);

      await importInto(view, 'h2');

      expect(importedCurrency()).toBe('USD');
    });

    it('keeps a currency the user picked when the target changes', async () => {
      setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding, usdHolding] });
      const view = await renderMonobankScreen();
      await mapMonobankColumns(view);
      await fireEvent.press(view.getByTestId('column-mapping-fixed-currency'));
      await fireEvent.changeText(
        view.getByPlaceholderText(i18n.t('forms.fields.searchCurrencyPlaceholder')),
        'USD',
      );
      await fireEvent.press(view.getByTestId('currency-option-USD'));

      await importInto(view, 'h1');

      expect(importedCurrency()).toBe('USD');
    });

    // A bank mapping is shared by every account of that bank; its currency
    // belongs to the holding it was saved for.
    it('ignores the currency a saved mapping carries from another account', async () => {
      setLiveData({
        accounts: [monobankAccount],
        holdings: [monobankHolding, usdHolding],
        statementMappings: { 'bank:monobank': savedMonobankMapping() },
      });
      const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
      await waitFor(() =>
        expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy(),
      );

      await importInto(view, 'h2');

      expect(importedCurrency()).toBe('USD');
    });
  });

  it('saves Kyiv as the time zone when the user leaves it as is', async () => {
    await importMappedMonobankStatement();

    await waitFor(() => expect(mockSaveStatementMapping).toHaveBeenCalledTimes(1));
    expect(mockSaveStatementMapping.mock.calls[0][1]).toEqual(
      expect.objectContaining({ timeZone: 'kyiv' }),
    );
  });

  it('saves a picked time zone with the mapping', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockDefaultImportSuccess();
    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);

    await fireEvent.press(view.getByTestId('column-mapping-time-zone'));
    await fireEvent.press(view.getByTestId('column-mapping-time-zone-option-central-europe'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockSaveStatementMapping).toHaveBeenCalledTimes(1));
    expect(mockSaveStatementMapping.mock.calls[0][1]).toEqual(
      expect.objectContaining({ timeZone: 'central-europe' }),
    );
    expect(
      within(view.getByTestId('column-mapping-time-zone')).getByText(
        i18n.t('columnMapping.timeZoneCentralEurope'),
      ),
    ).toBeTruthy();
  });

  it.each([
    [undefined, i18n.t('columnMapping.timeZoneKyiv')],
    ['UTC+05:30', i18n.t('columnMapping.timeZoneFixedOffset', { offset: '+05:30' })],
  ])('pre-fills the time zone of a saved mapping stored with %s', async (timeZone, label) => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: { 'bank:monobank': savedMonobankMapping({ timeZone }) },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());
    expect(within(view.getByTestId('column-mapping-time-zone')).getByText(label)).toBeTruthy();
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

  // The account and settings queries are uncached, so on the auto-replace path
  // the file can be read before either lands; the one-shot pre-fill must wait
  // for both instead of settling on a guessed header row.
  it('still pre-fills the saved mapping when the file rows arrive before the settings', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    let queriesLoaded = false;
    mockUseLiveQuery.mockImplementation((_query: { __kind?: string }, tables: string[]) => {
      if (tables[0] === 'holdings') {
        return { data: [monobankHolding], isLoading: false };
      }

      if (!queriesLoaded) {
        return { data: [], isLoading: true };
      }

      return tables[0] === 'settings'
        ? {
            data: [
              {
                baseCurrency: 'UAH',
                statementMappings: { 'bank:monobank': savedMonobankMapping() },
              },
            ],
            isLoading: false,
          }
        : { data: [monobankAccount], isLoading: false };
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    queriesLoaded = true;
    await view.rerender(
      <ColumnMappingScreen
        route={asRouteProp<ColumnMappingProps['route']>('ColumnMapping', {
          filePath: '/mock/statement.csv',
          accountId: 'a',
        })}
        navigation={asNavigationProp<ColumnMappingProps['navigation']>(view.navigation)}
      />,
    );

    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());
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
      // Under UTF-8 the guess lands on row 8, below the real header, so the
      // header row is only reachable from the expanded preview.
      await fireEvent.press(view.getByTestId('raw-preview-toggle'));
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

  it('navigates once the sheet reports onClosed, asking the account page for the import reminder offer', async () => {
    const view = await renderMonobankImportSuccess();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: 'Monobank', reminderOffer: 'afterImport' },
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

type ScreenView = Awaited<ReturnType<typeof renderScreen>>;

const pickOption = async (
  view: ScreenView,
  field: string,
  option: string | number,
): Promise<void> => {
  await fireEvent.press(view.getByTestId(`column-mapping-${field}`));
  await fireEvent.press(view.getByTestId(`column-mapping-${field}-option-${option}`));
};

const pressImport = async (view: ScreenView): Promise<void> => {
  await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
};

const switchAmountModeToDebitCredit = async (view: ScreenView): Promise<void> => {
  await fireEvent.press(
    within(view.getByTestId('column-mapping-amount-mode')).getByText(
      i18n.t('columnMapping.amountModeDebitCredit'),
    ),
  );
};

const switchCurrencyModeToColumn = async (view: ScreenView): Promise<void> => {
  await fireEvent.press(
    within(view.getByTestId('column-mapping-currency-mode')).getByText(
      i18n.t('columnMapping.currencyColumn'),
    ),
  );
};

const fieldErrorTexts = {
  date: i18n.t('columnMapping.dateColumnError'),
  dateFormat: i18n.t('columnMapping.dateFormatError'),
  amount: i18n.t('columnMapping.amountColumnError'),
  debit: i18n.t('columnMapping.debitColumnError'),
  credit: i18n.t('columnMapping.creditColumnError'),
  currency: i18n.t('columnMapping.currencyColumnError'),
  description: i18n.t('columnMapping.descriptionColumnError'),
  noRows: i18n.t('columnMapping.noRowsResolvedError'),
  holding: i18n.t('statementImport.chooseHoldingError'),
};

describe('ColumnMappingScreen — load states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('reads the file as base64 and shows only the reading message, no form and no Import button, while it loads', async () => {
    mockReadFile.mockReturnValue(new Promise(() => {}));

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    expect(mockReadFile).toHaveBeenCalledWith('/mock/statement.csv', 'base64');
    expect(view.getByText(i18n.t('statementImport.reading'))).toBeTruthy();
    expect(view.queryByText(i18n.t('columnMapping.rawPreview'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importButton'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.unrecognizedFormat'))).toBeNull();
    expect(view.queryByText(i18n.t('columnMapping.xlsNotSupported'))).toBeNull();
  });

  it('shows the unreadable message with the supported formats, and no form or Import button, when the file cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('gone'));

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() =>
      expect(
        view.getByText(
          i18n.t('statementImport.unrecognizedFormat', { formats: supportedFormatNames }),
        ),
      ).toBeTruthy(),
    );
    expect(view.queryByText(i18n.t('statementImport.reading'))).toBeNull();
    expect(view.queryByText(i18n.t('columnMapping.rawPreview'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importButton'))).toBeNull();
  });

  it('shows the .xls-not-supported message, and nothing else, for a legacy .xls file', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderScreen({ filePath: '/mock/old-statement.xls', accountId: 'a' });

    await waitFor(() =>
      expect(view.getByText(i18n.t('columnMapping.xlsNotSupported'))).toBeTruthy(),
    );
    expect(view.queryByText(i18n.t('statementImport.reading'))).toBeNull();
    expect(view.queryByText(i18n.t('columnMapping.rawPreview'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importButton'))).toBeNull();
    expect(mockReadSheetRowsSafely).not.toHaveBeenCalled();
  });

  it('maps and previews the pre-parsed rows of an .xlsx file instead of decoding text', async () => {
    mockReadFile.mockResolvedValue('c3ByZWFkc2hlZXQ=');
    mockReadSheetRowsSafely.mockResolvedValue([
      ['Date', 'Narrative', 'Amount'],
      ['01.01.2024', 'Coffee', 10],
    ]);

    const view = await renderScreen({ filePath: '/mock/statement.xlsx', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

    expect(mockReadSheetRowsSafely).toHaveBeenCalledWith('c3ByZWFkc2hlZXQ=');
    expect(view.queryByTestId('column-mapping-encoding')).toBeNull();

    await pickOption(view, 'date-column', 0);
    await pickOption(view, 'date-format', 'DD.MM.YYYY');
    await pickOption(view, 'description-column', 1);
    await pickOption(view, 'amount-column', 2);

    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('1'),
    );
  });

  it('does not start reading a spreadsheet when the screen is gone before the file arrived', async () => {
    let resolveFile: (base64: string) => void = () => {};
    mockReadFile.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveFile = resolve;
      }),
    );

    const view = await renderScreen({ filePath: '/mock/statement.xlsx', accountId: 'a' });
    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      resolveFile('c3ByZWFkc2hlZXQ=');
    });

    expect(mockReadSheetRowsSafely).not.toHaveBeenCalled();
  });

  it('starts clean once ready: no saved-mapping caption, no result sheet, no row errors', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.queryByText(i18n.t('columnMapping.savedApplied'))).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    expect(view.queryByTestId('column-mapping-row-errors')).toBeNull();
    expect(view.queryByText(i18n.t('statementImport.reading'))).toBeNull();
  });

  it('offers no column to pick for a file with no rows at all', async () => {
    mockReadFile.mockResolvedValue('');

    const view = await renderMonobankScreen();
    await fireEvent.press(view.getByTestId('column-mapping-date-column'));

    expect(view.queryByTestId('column-mapping-date-column-option-0')).toBeNull();
  });

  it('labels a blank header cell by its position, whitespace included', async () => {
    mockReadFile.mockResolvedValue(
      Buffer.from('Date, ,,Amount\n01.01.2024,Coffee,x,10\n', 'utf-8').toString('base64'),
    );

    const view = await renderMonobankScreen();
    await fireEvent.press(view.getByTestId('raw-preview-toggle'));
    await fireEvent.press(view.getByTestId('raw-preview-row-0'));
    await fireEvent.press(view.getByTestId('column-mapping-date-column'));

    expect(
      within(view.getByTestId('column-mapping-date-column-option-0')).getByText('Date'),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('column-mapping-date-column-option-1')).getByText('#2'),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('column-mapping-date-column-option-2')).getByText('#3'),
    ).toBeTruthy();
  });

  it('falls back to UAH as the fixed currency when the account has no holding yet', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({ accounts: [monobankAccount], holdings: [] });

    const view = await renderMonobankScreen();

    expect(
      within(view.getByTestId('column-mapping-fixed-currency')).getByText('Ukrainian Hryvnia'),
    ).toBeTruthy();
  });

  it('keeps the delimiter the user picked instead of the detected one', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();
    const delimiter = within(view.getByTestId('column-mapping-delimiter'));

    expect(delimiter.getByRole('button', { name: ',', selected: true })).toBeTruthy();

    await fireEvent.press(delimiter.getByText(';'));

    expect(delimiter.getByRole('button', { name: ';', selected: true })).toBeTruthy();
    expect(delimiter.queryByRole('button', { name: ',', selected: true })).toBeNull();
  });

  it('keeps the header row the user tapped when other inputs re-render the preview', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();
    await fireEvent.press(view.getByTestId('raw-preview-row-1'));
    await fireEvent.press(
      within(view.getByTestId('column-mapping-decimal-separator')).getByText(','),
    );
    await fireEvent.press(view.getByTestId('column-mapping-date-column'));

    const firstDataRowDate = monobankFixtureText.split('\n')[1].split(',')[0];
    expect(
      within(view.getByTestId('column-mapping-date-column-option-0')).getByText(firstDataRowDate),
    ).toBeTruthy();
  });
});

describe('ColumnMappingScreen — saved mapping prefill details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
  });

  it('pre-fills a saved debit/credit amount and a saved currency column', async () => {
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: {
        'bank:monobank': {
          ...savedMonobankMapping(),
          amount: { mode: 'debitCredit', debitColumn: 3, creditColumn: 4 },
          currency: { mode: 'column', column: 5 },
        },
      },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());

    expect(
      within(view.getByTestId('column-mapping-debit-column')).getByText(monobankHeaderRow[3]),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('column-mapping-credit-column')).getByText(monobankHeaderRow[4]),
    ).toBeTruthy();
    expect(view.queryByTestId('column-mapping-amount-column')).toBeNull();
    expect(
      within(view.getByTestId('column-mapping-currency-column')).getByText(monobankHeaderRow[5]),
    ).toBeTruthy();
    expect(view.queryByTestId('column-mapping-fixed-currency')).toBeNull();
  });

  it('pre-fills a saved single amount column', async () => {
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: { 'bank:monobank': savedMonobankMapping() },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());

    expect(
      within(view.getByTestId('column-mapping-amount-column')).getByText(monobankHeaderRow[3]),
    ).toBeTruthy();
    expect(view.queryByTestId('column-mapping-debit-column')).toBeNull();
  });

  // Only one of the two queries still loading must hold the one-shot pre-fill
  // back, not just both of them.
  it.each([['accounts'], ['settings']])(
    'waits for the %s query alone before pre-filling the saved mapping',
    async (slowTable) => {
      let loaded = false;
      mockUseLiveQuery.mockImplementation((_query: { __kind?: string }, tables: string[]) => {
        if (tables[0] === 'holdings') {
          return { data: [monobankHolding], isLoading: false };
        }

        const isSlow = tables[0] === slowTable && !loaded;

        if (tables[0] === 'settings') {
          return {
            data: [
              {
                baseCurrency: 'UAH',
                statementMappings: { 'bank:monobank': savedMonobankMapping() },
              },
            ],
            isLoading: isSlow,
          };
        }

        return { data: tables[0] === 'accounts' ? [monobankAccount] : [], isLoading: isSlow };
      });

      const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
      await waitFor(() => expect(view.getByText(i18n.t('columnMapping.rawPreview'))).toBeTruthy());

      loaded = true;
      await view.rerender(
        <ColumnMappingScreen
          route={asRouteProp<ColumnMappingProps['route']>('ColumnMapping', {
            filePath: '/mock/statement.csv',
            accountId: 'a',
          })}
          navigation={asNavigationProp<ColumnMappingProps['navigation']>(view.navigation)}
        />,
      );

      await waitFor(() =>
        expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy(),
      );
    },
  );
});

describe('ColumnMappingScreen — mapping completeness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  const incompleteHint = (view: ScreenView) => view.queryByText(i18n.t('columnMapping.incomplete'));

  it.each([
    ['date column', 'date-column', 0],
    ['date format', 'date-format', 'DD.MM.YYYY HH:MM:SS'],
    ['description column', 'description-column', 1],
    ['amount column', 'amount-column', 3],
  ] as const)('stays incomplete while only the %s is unmapped', async (_name, omitted, _option) => {
    const view = await renderMonobankScreen();
    const steps = [
      ['date-column', 0],
      ['date-format', 'DD.MM.YYYY HH:MM:SS'],
      ['description-column', 1],
      ['amount-column', 3],
    ] as const;

    for (const [field, option] of steps) {
      if (field !== omitted) {
        await pickOption(view, field, option);
      }
    }

    expect(incompleteHint(view)).toBeTruthy();
  });

  it('is complete only once both the debit and the credit column are mapped', async () => {
    const view = await renderMonobankScreen();
    await mapDateFormatAndDescription(view);
    await switchAmountModeToDebitCredit(view);

    await pickOption(view, 'debit-column', 3);
    expect(incompleteHint(view)).toBeTruthy();

    await pickOption(view, 'credit-column', 4);
    expect(incompleteHint(view)).toBeNull();
  });

  it('is incomplete with only the credit column mapped', async () => {
    const view = await renderMonobankScreen();
    await mapDateFormatAndDescription(view);
    await switchAmountModeToDebitCredit(view);

    await pickOption(view, 'credit-column', 4);

    expect(incompleteHint(view)).toBeTruthy();
  });

  it('is incomplete in currency-column mode until a currency column is picked', async () => {
    const view = await renderMonobankScreen();
    await mapMonobankColumns(view);
    await switchCurrencyModeToColumn(view);

    expect(incompleteHint(view)).toBeTruthy();

    await pickOption(view, 'currency-column', 5);

    expect(incompleteHint(view)).toBeNull();
  });
});

describe('ColumnMappingScreen — validation on Import press', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('shows no error before the first press, then every required field error and nothing else', async () => {
    const view = await renderMonobankScreen();

    expect(view.queryByText(fieldErrorTexts.date)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.holding)).toBeNull();

    await pressImport(view);

    expect(view.getByText(fieldErrorTexts.date)).toBeTruthy();
    expect(view.getByText(fieldErrorTexts.dateFormat)).toBeTruthy();
    expect(view.getByText(fieldErrorTexts.amount)).toBeTruthy();
    expect(view.getByText(fieldErrorTexts.description)).toBeTruthy();
    expect(view.getByText(fieldErrorTexts.holding)).toBeTruthy();
    expect(view.queryByText(fieldErrorTexts.debit)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.credit)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.currency)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.noRows)).toBeNull();
    expect(mockImportParsedStatement).not.toHaveBeenCalled();
  });

  it('flags only the missing holding once every column is mapped and rows resolve', async () => {
    const view = await renderMonobankScreen();
    await mapMonobankColumns(view);
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    await pressImport(view);

    expect(view.getByText(fieldErrorTexts.holding)).toBeTruthy();
    expect(view.queryByText(fieldErrorTexts.date)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.dateFormat)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.amount)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.description)).toBeNull();
    expect(view.queryByText(fieldErrorTexts.noRows)).toBeNull();
    expect(mockImportParsedStatement).not.toHaveBeenCalled();
  });

  it('flags the debit and credit columns, not the single amount column, in debit/credit mode', async () => {
    const view = await renderMonobankScreen();
    await switchAmountModeToDebitCredit(view);

    await pressImport(view);

    expect(view.getByText(fieldErrorTexts.debit)).toBeTruthy();
    expect(view.getByText(fieldErrorTexts.credit)).toBeTruthy();
    expect(view.queryByText(fieldErrorTexts.amount)).toBeNull();

    await pickOption(view, 'debit-column', 3);

    expect(view.queryByText(fieldErrorTexts.debit)).toBeNull();
    expect(view.getByText(fieldErrorTexts.credit)).toBeTruthy();

    await pickOption(view, 'credit-column', 4);

    expect(view.queryByText(fieldErrorTexts.credit)).toBeNull();
  });

  it('flags a missing currency column only in currency-column mode', async () => {
    const view = await renderMonobankScreen();
    await switchCurrencyModeToColumn(view);

    await pressImport(view);

    expect(view.getByText(fieldErrorTexts.currency)).toBeTruthy();

    await pickOption(view, 'currency-column', 5);

    expect(view.queryByText(fieldErrorTexts.currency)).toBeNull();
  });

  it('does not blame the currency column when a mapped column resolves its currencies', async () => {
    const view = await renderMonobankScreen();
    await mapMonobankColumns(view);
    await switchCurrencyModeToColumn(view);
    await pickOption(view, 'currency-column', 5);

    await pressImport(view);

    expect(view.queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
    expect(view.queryByText(fieldErrorTexts.currency)).toBeNull();
    expect(view.getByText(fieldErrorTexts.holding)).toBeTruthy();
  });

  it('blames the no-rows result, not a currency column, when the data rows are blank cells', async () => {
    mockReadFile.mockResolvedValue(
      Buffer.from('Date,Description,Amount,Currency\n , , , \n , , , \n', 'utf-8').toString(
        'base64',
      ),
    );
    const view = await renderMonobankScreen();
    await mapDateFormatDescriptionAndAmount(view, {
      dateFormatId: 'DD.MM.YYYY',
      amountColumn: 2,
    });
    await switchCurrencyModeToColumn(view);
    await pickOption(view, 'currency-column', 3);
    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    await pressImport(view);

    expect(view.getByText(fieldErrorTexts.noRows)).toBeTruthy();
    expect(view.queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
  });
});

describe('ColumnMappingScreen — scroll to the first invalid field', () => {
  const scrollToFieldMock = scrollToField as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  // The field-ref wrapper's own first child is the field (or field group)
  // that carries the scroll target's identity.
  const pressAndReadTarget = async (view: ScreenView): Promise<string | undefined> => {
    scrollToFieldMock.mockClear();
    await pressImport(view);

    const [, targetRef] = scrollToFieldMock.mock.calls[0];
    const child = targetRef.current.props.children;

    return child.props.testID ?? (child.props.noRowsResolvedError ? 'result' : undefined);
  };

  it('walks the form top to bottom as each blocking field gets fixed', async () => {
    const view = await renderMonobankScreen();

    expect(await pressAndReadTarget(view)).toBe('column-mapping-date-column');

    await pickOption(view, 'date-column', 0);
    expect(await pressAndReadTarget(view)).toBe('column-mapping-date-format');

    await pickOption(view, 'date-format', 'DD.MM.YYYY HH:MM:SS');
    expect(await pressAndReadTarget(view)).toBe('column-mapping-amount-mode');

    await pickOption(view, 'amount-column', 3);
    await switchCurrencyModeToColumn(view);
    expect(await pressAndReadTarget(view)).toBe('column-mapping-currency-mode');

    await pickOption(view, 'currency-column', 5);
    expect(await pressAndReadTarget(view)).toBe('column-mapping-description-column');

    await pickOption(view, 'description-column', 1);
    expect(await pressAndReadTarget(view)).toBe('target-holding-field');
  });

  it('targets the amount group while the credit column is missing, and moves on once it is mapped', async () => {
    const view = await renderMonobankScreen();
    await mapDateFormatAndDescription(view);
    await switchAmountModeToDebitCredit(view);

    await pickOption(view, 'debit-column', 3);
    expect(await pressAndReadTarget(view)).toBe('column-mapping-amount-mode');

    await pickOption(view, 'credit-column', 4);
    expect(await pressAndReadTarget(view)).not.toBe('column-mapping-amount-mode');
  });

  it('targets the amount group while only the debit column is missing', async () => {
    const view = await renderMonobankScreen();
    await mapDateFormatAndDescription(view);
    await switchAmountModeToDebitCredit(view);

    await pickOption(view, 'credit-column', 4);

    expect(await pressAndReadTarget(view)).toBe('column-mapping-amount-mode');
  });

  it('targets the result block when no row resolves, before the holding field', async () => {
    const view = await renderMonobankScreen();
    await mapDateFormatDescriptionAndAmount(view, { dateFormatId: 'YYYY-MM-DD', amountColumn: 3 });

    expect(await pressAndReadTarget(view)).toBe('result');
  });

  it('hands the scroll the live content height', async () => {
    const view = await renderMonobankScreen();
    await fireEvent(view.getByTestId('screen-scroll-view'), 'contentSizeChange', 320, 1234);

    scrollToFieldMock.mockClear();
    await pressImport(view);

    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
    expect(scrollToFieldMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({ contentHeight: 1234 }),
    );
  });

  it('does not scroll when the press imports', async () => {
    mockDefaultImportSuccess();
    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);

    await pressImport(view);

    await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));
    expect(scrollToFieldMock).not.toHaveBeenCalled();
  });
});

describe('ColumnMappingScreen — import outcomes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('alerts with the translated failure and shows no result when the import throws', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportParsedStatement.mockRejectedValue(new Error('disk full'));
    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);

    await pressImport(view);

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        i18n.t('statementImport.importErrorTitle'),
        i18n.t('statementImport.importErrorMessage'),
      ),
    );
    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    expect(mockSaveStatementMapping).not.toHaveBeenCalled();

    // The press is released again, so the user can retry.
    mockDefaultImportSuccess();
    await pressImport(view);

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );
  });

  it('saves the mapping with the fingerprint of the chosen header row', async () => {
    await importMappedMonobankStatement();

    await waitFor(() => expect(mockSaveStatementMapping).toHaveBeenCalledTimes(1));
    expect(mockSaveStatementMapping.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        fingerprint: headerFingerprint(monobankHeaderRow),
        savedAt: expect.any(Number),
      }),
    );
  });

  it('keys the saved mapping by header fingerprint, and goes back, for a screen with no account', async () => {
    setLiveData({ accounts: [], holdings: [monobankHolding] });
    mockDefaultImportSuccess();
    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);

    await pressImport(view);

    await waitFor(() => expect(mockSaveStatementMapping).toHaveBeenCalledTimes(1));
    expect(mockSaveStatementMapping.mock.calls[0][0]).toBe(
      `header:${headerFingerprint(monobankHeaderRow)}`,
    );

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );
    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.goBack).toHaveBeenCalledTimes(1);
    expect(view.navigation.popTo).not.toHaveBeenCalled();
  });
});
