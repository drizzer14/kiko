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
jest.mock('./../statement-import/target-holding-sheet', () => {
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
// still-incomplete-mapping test (F4: no amount column mapped, say) shares
// this exact sequence with `mapMonobankColumns` below instead of a
// hand-copied near-duplicate (jscpd).
const mapDateFormatAndDescription = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
): Promise<void> => {
  await fireEvent.press(view.getByTestId('column-mapping-date-column'));
  await fireEvent.press(view.getByTestId('column-mapping-date-column-option-0'));

  await fireEvent.press(view.getByTestId('column-mapping-date-format'));
  await fireEvent.press(view.getByTestId('column-mapping-date-format-option-DD.MM.YYYY HH:MM:SS'));

  await fireEvent.press(view.getByTestId('column-mapping-description-column'));
  await fireEvent.press(view.getByTestId('column-mapping-description-column-option-1'));
};

// Drives the screen through the exact T4 Monobank mapping: header row 0
// (already the auto-guess), date column 0 + 'DD.MM.YYYY HH:MM:SS', amount
// column 3 (single mode, the default), description column 1 — fixed UAH
// currency (the default, matching the seeded holding's own currency).
const mapMonobankColumns = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
): Promise<void> => {
  await mapDateFormatAndDescription(view);

  await fireEvent.press(view.getByTestId('column-mapping-amount-column'));
  await fireEvent.press(view.getByTestId('column-mapping-amount-column-option-3'));
};

// Every field required for a T4 Monobank import: the columns above, plus
// picking the one seeded holding — shared by every test that goes on to
// press Import, so the "map, then pick holding h1" pair is written once.
const mapMonobankColumnsAndSelectHolding = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
  holdingId = 'h1',
): Promise<void> => {
  await mapMonobankColumns(view);
  await fireEvent.press(view.getByTestId(`mock-select-holding-${holdingId}`));
};

describe('ColumnMappingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('maps the Monobank fixture with the T4 mapping and shows 4 transactions', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    await mapMonobankColumns(view);

    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );
  });

  // F3 item 12: the screen body no longer duplicates the native stack
  // header's own title — the header (`accounts.stack.tsx`'s `title:
  // t('columnMapping.title')`) is not itself rendered by this component
  // under test (it lives in the navigator), so this pins that the
  // screen's OWN body renders that exact string ZERO times.
  it('does not render a second in-body title duplicating the screen header (F3 item 12)', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.queryByText(i18n.t('columnMapping.title'))).toBeNull();
  });

  // F3 item 14: every section on this screen shows its own heading.
  it('shows a heading for every section (F3 item 14)', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.getByText(i18n.t('columnMapping.sectionFileFormat'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionDates'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionAmount'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionCurrency'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.sectionDetails'))).toBeTruthy();
    expect(view.getByText(i18n.t('columnMapping.result'))).toBeTruthy();
  });

  // Item 2 (F3, BUG): same "Add new" holding return channel as
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

  // Item 11 (F3): a holding already chosen on the statement-import preview
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

  // Item 11 (F3): the holding field carries the same required marker every
  // other required field on this screen already shows — date, date format,
  // the single-mode amount column, and description already mark 4; the
  // holding field adds a 5th.
  it('marks the target-holding field as required, alongside the screen’s existing required fields', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderMonobankScreen();

    expect(view.getAllByText('*', { includeHiddenElements: true })).toHaveLength(5);
  });

  it('switching the decimal separator changes the parsed result', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockDefaultImportSuccess();

    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
    await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));
    const dotAmounts = mockImportParsedStatement.mock.calls[0][0].transactions.map(
      (transaction: { amountMinorUnits: number }) => transaction.amountMinorUnits,
    );

    // Monobank's own amounts are plain '.'-decimal numbers (e.g. "-100.00")
    // — forcing the WRONG decimal separator (',') doesn't throw (every cell
    // still parses to SOME finite number, per Review Focus 1), it silently
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

  // F4 audit 1: Import is ALWAYS enabled (never `disabled={!canImport}`) —
  // pressing it with no amount column mapped validates on press instead,
  // showing the field's own inline error rather than a silently inert
  // button.
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

  // Item 15 (F3): a successful Import shows a MODAL with the result text.
  it('shows the import result as a modal', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockDefaultImportSuccess();

    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() =>
      expect(view.getByText(i18n.t('statementImport.importResultTitle'))).toBeTruthy(),
    );
  });

  it('imports then saves the confirmed mapping under bank:<bankId>', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockDefaultImportSuccess();

    const view = await renderMonobankScreen();
    await mapMonobankColumnsAndSelectHolding(view);
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));
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
      statementMappings: {
        'bank:monobank': {
          headerRowIndex: 0,
          decimalSeparator: '.',
          dateColumn: 0,
          dateFormat: 'DD.MM.YYYY HH:MM:SS',
          amount: { mode: 'single', column: 3 },
          descriptionColumn: 1,
          currency: { mode: 'fixed', currency: 'UAH' },
          fingerprint: headerFingerprint(monobankHeaderRow),
          savedAt: 1_700_000_000_000,
        },
      },
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });

    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.savedApplied'))).toBeTruthy());
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    // Review Focus 3: the pre-filled preview must NOT have imported anything
    // on its own — the user still has to pick a holding and tap Import.
    expect(mockImportParsedStatement).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));

    await waitFor(() => expect(mockImportParsedStatement).toHaveBeenCalledTimes(1));
  });

  // M5 (review round 1): the optional Balance column role renders as a
  // field, and a saved mapping's `balanceColumn` pre-fills it — same
  // pattern as the exact-saved-mapping test above, plus this one field.
  it('renders the Balance field and pre-fills it from a saved mapping', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    setLiveData({
      accounts: [monobankAccount],
      holdings: [monobankHolding],
      statementMappings: {
        'bank:monobank': {
          headerRowIndex: 0,
          decimalSeparator: '.',
          dateColumn: 0,
          dateFormat: 'DD.MM.YYYY HH:MM:SS',
          amount: { mode: 'single', column: 3 },
          descriptionColumn: 1,
          currency: { mode: 'fixed', currency: 'UAH' },
          balanceColumn: 9,
          fingerprint: headerFingerprint(monobankHeaderRow),
          savedAt: 1_700_000_000_000,
        },
      },
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

// N4 (F3 part 1 fix round 2) + R2-1 (fix round 3): on Done, the sheet
// closes FIRST, and only navigates once the sheet's `onClosed` fires
// (`BottomSheet`'s pass-through of RN `Modal`'s own `onDismiss`) — see the
// matching describe block in statement-import.screen.test.tsx for the full
// rationale.
describe('ColumnMappingScreen — Done closes the sheet before navigating (N4, R2-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  const importSuccessfully = async (): Promise<Awaited<ReturnType<typeof renderScreen>>> => {
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

  it('Done closes the sheet, but does not navigate on its own', async () => {
    const view = await importSuccessfully();

    await fireEvent.press(view.getByText(i18n.t('common.done')));

    expect(view.queryByText(i18n.t('statementImport.importResultTitle'))).toBeNull();
    expect(view.navigation.popTo).not.toHaveBeenCalled();
    expect(view.navigation.goBack).not.toHaveBeenCalled();
  });

  it('navigates once the sheet reports onClosed', async () => {
    const view = await importSuccessfully();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.popTo).toHaveBeenCalledWith(
      'AccountDetail',
      { accountId: 'a', name: 'Monobank' },
      { merge: true },
    );
    expect(view.navigation.navigate).not.toHaveBeenCalledWith('AccountDetail', expect.anything());
  });

  it('a repeated onClosed (a double Done tap) navigates once', async () => {
    const view = await importSuccessfully();

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');
    expect(view.navigation.popTo).toHaveBeenCalledTimes(1);

    await fireEvent(view.getByTestId('import-result-sheet-modal'), 'dismiss');

    expect(view.navigation.popTo).toHaveBeenCalledTimes(1);
  });
});

// M8 (F3 part 1 fix round 1, Important) + N2 (fix round 2, Important): the
// local cache copy item 6's fix makes is deleted once this screen is
// removed from the stack, but ONLY when this screen OWNS the file
// (ownsFile, set exclusively by StatementImportScreen's T7 auto-replace).
// Reached instead by "Map columns manually" (a PUSH), StatementImport
// stays mounted underneath and still owns the file — deleting it here on a
// plain Back would strand that still-reachable preview (item 6's exact bug
// again).
describe('ColumnMappingScreen — local copy cleanup (M8, N2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('deletes the local cache copy on unmount when it OWNS the file (the T7 auto-replace path)', async () => {
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

  // N2: the "Map columns manually" push — no ownsFile — must NOT delete on
  // Back, since the preview screen underneath still owns and reads the
  // SAME file. This is the literal "preview -> Map columns -> Back -> Map
  // columns again" scenario the review asked to be proven.
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

  // N2's literal repro scenario: preview -> Map columns -> Back -> the file
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
