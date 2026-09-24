import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
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
jest.mock('react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
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

const renderScreen = async (params: { filePath: string; accountId: string }) => {
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

// Drives the screen through the exact T4 Monobank mapping: header row 0
// (already the auto-guess), date column 0 + 'DD.MM.YYYY HH:MM:SS', amount
// column 3 (single mode, the default), description column 1 — fixed UAH
// currency (the default, matching the seeded holding's own currency).
const mapMonobankColumns = async (
  view: Awaited<ReturnType<typeof renderScreen>>,
): Promise<void> => {
  await fireEvent.press(view.getByTestId('column-mapping-date-column'));
  await fireEvent.press(view.getByTestId('column-mapping-date-column-option-0'));

  await fireEvent.press(view.getByTestId('column-mapping-date-format'));
  await fireEvent.press(view.getByTestId('column-mapping-date-format-option-DD.MM.YYYY HH:MM:SS'));

  await fireEvent.press(view.getByTestId('column-mapping-amount-column'));
  await fireEvent.press(view.getByTestId('column-mapping-amount-column-option-3'));

  await fireEvent.press(view.getByTestId('column-mapping-description-column'));
  await fireEvent.press(view.getByTestId('column-mapping-description-column-option-1'));
};

describe('ColumnMappingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({ accounts: [monobankAccount], holdings: [monobankHolding] });
  });

  it('maps the Monobank fixture with the T4 mapping and shows 4 transactions', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.title'))).toBeTruthy());

    await mapMonobankColumns(view);

    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );
  });

  it('switching the decimal separator changes the parsed result', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockImportParsedStatement.mockResolvedValue({
      formatId: 'column-mapping',
      imported: 4,
      total: 4,
      skippedWrongCurrency: 0,
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.title'))).toBeTruthy());
    await mapMonobankColumns(view);
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
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

  it('Import stays disabled with no amount column mapped', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.title'))).toBeTruthy());

    await fireEvent.press(view.getByTestId('column-mapping-date-column'));
    await fireEvent.press(view.getByTestId('column-mapping-date-column-option-0'));
    await fireEvent.press(view.getByTestId('column-mapping-date-format'));
    await fireEvent.press(
      view.getByTestId('column-mapping-date-format-option-DD.MM.YYYY HH:MM:SS'),
    );
    await fireEvent.press(view.getByTestId('column-mapping-description-column'));
    await fireEvent.press(view.getByTestId('column-mapping-description-column-option-1'));

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));

    expect(view.getByText(i18n.t('statementImport.importButton')).props.disabled).not.toBe(false);
    await fireEvent.press(view.getByText(i18n.t('statementImport.importButton')));
    expect(mockImportParsedStatement).not.toHaveBeenCalled();
  });

  it('imports then saves the confirmed mapping under bank:<bankId>', async () => {
    mockReadFile.mockResolvedValue(monobankFixtureBase64);
    mockImportParsedStatement.mockResolvedValue({
      formatId: 'column-mapping',
      imported: 4,
      total: 4,
      skippedWrongCurrency: 0,
    });

    const view = await renderScreen({ filePath: '/mock/statement.csv', accountId: 'a' });
    await waitFor(() => expect(view.getByText(i18n.t('columnMapping.title'))).toBeTruthy());
    await mapMonobankColumns(view);
    await waitFor(() =>
      expect(view.getByTestId('column-mapping-transaction-count')).toHaveTextContent('4'),
    );

    await fireEvent.press(view.getByTestId('mock-select-holding-h1'));
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
    mockImportParsedStatement.mockResolvedValue({
      formatId: 'column-mapping',
      imported: 4,
      total: 4,
      skippedWrongCurrency: 0,
    });
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
      await waitFor(() => expect(view.getByText(i18n.t('columnMapping.title'))).toBeTruthy());

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
