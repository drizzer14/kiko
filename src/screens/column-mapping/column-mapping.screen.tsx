import type { FC } from 'react';
import type { TFunction } from 'i18next';
import * as RNFS from 'react-native-fs';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { Currency } from '../../currency/currency';
import { holdingsRepo } from '../../holdings/repo';
import type { SpreadsheetCellValue, StatementFormatInput } from '../../statement-import/parser';
import {
  fileNameOf,
  isXlsxFile,
  isLegacyXlsFile,
  decodeStatementText,
  readSheetRowsSafely,
} from '../../statement-import/read-statement-file';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { accountsRepo } from '../../accounts/accounts.repo';
import { settingsRepo } from '../../settings/settings.repo';
import OptionPills from '../../design-system/components/option-pills';
import type { AccountsStackParamList } from '../../navigation/types';
import { supportedFormatNames } from '../../statement-import/registry';
import {
  type TableCell,
  type ColumnMapping,
  type DateFormatId,
  type TableDelimiter,
  type SavedColumnMapping,
  type ColumnMappingRowError,
  dateFormatIds,
  readTableRows,
  mappingKeyFor,
  applyColumnMapping,
  findSavedMapping,
  headerFingerprint,
  guessHeaderRowIndex,
} from '../../statement-import/column-mapping';
import { importParsedStatement, type ImportResult } from '../../statement-import/import-statement';

import RawPreview from './raw-preview';
import AmountFields from './amount-fields';
import { styles } from './column-mapping.styles';
import CurrencyFields from './currency-fields';
import MappingResult from './mapping-result';
import ColumnSelectField from './column-select-field';
import ImportOutcome from '../statement-import/import-outcome';
import TargetHoldingSheet from '../statement-import/target-holding-sheet';
import { previewStats, type PreviewStats } from '../statement-import/preview-stats/preview-stats';
import type { AmountMode } from './amount-fields/amount-fields.props';
import type { CurrencyMode } from './currency-fields/currency-fields.props';
import type { ColumnSelectFieldOption } from './column-select-field/column-select-field.props';
import { useTargetHoldingOptions } from '../statement-import/use-target-holding-options/use-target-holding-options';

type ColumnMappingScreenProps = NativeStackScreenProps<AccountsStackParamList, 'ColumnMapping'>;

type Encoding = 'utf-8' | 'windows-1251';

// The file-read pipeline's own state — kept separate from the derived
// mapping/preview below, mirroring `statement-import.screen.tsx`'s own
// `LoadState`, plus the `.xls`-specific terminal state this screen alone
// needs (the brief: "and nothing else" once that state is reached).
type LoadState =
  | { kind: 'loading' }
  | { kind: 'unreadable' }
  | { kind: 'xlsNotSupported' }
  | {
      kind: 'ready';
      fileName: string;
      isXlsx: boolean;
      base64: string;
      sheetRows?: SpreadsheetCellValue[][];
    };

// Every mutable field the mapping form owns, bundled so `buildColumnMapping`
// reads one object instead of a 14-parameter argument list.
type MappingFormFields = {
  headerRowIndex: number | undefined;
  delimiter: TableDelimiter | undefined;
  encoding: Encoding;
  decimalSeparator: ',' | '.';
  dateColumn: number | undefined;
  dateFormat: DateFormatId | undefined;
  amountMode: AmountMode;
  amountColumn: number | undefined;
  debitColumn: number | undefined;
  creditColumn: number | undefined;
  descriptionColumn: number | undefined;
  currencyMode: CurrencyMode;
  currencyColumn: number | undefined;
  fixedCurrency: Currency;
  counterpartyColumn: number | undefined;
};

// `input.sheetRows` always wins over `text` once present (readTableRows's
// own doc comment) — a spreadsheet has no encoding of its own to redecode.
const tableInputFor = (
  loadState: LoadState,
  encoding: Encoding,
): StatementFormatInput | undefined => {
  if (loadState.kind !== 'ready') {
    return undefined;
  }

  return loadState.isXlsx
    ? { text: '', fileName: loadState.fileName, sheetRows: loadState.sheetRows }
    : { text: decodeStatementText(loadState.base64, encoding), fileName: loadState.fileName };
};

const buildAmount = (fields: MappingFormFields): ColumnMapping['amount'] | undefined => {
  if (fields.amountMode === 'single') {
    return fields.amountColumn === undefined
      ? undefined
      : { mode: 'single', column: fields.amountColumn };
  }

  return fields.debitColumn === undefined || fields.creditColumn === undefined
    ? undefined
    : { mode: 'debitCredit', debitColumn: fields.debitColumn, creditColumn: fields.creditColumn };
};

const buildCurrency = (fields: MappingFormFields): ColumnMapping['currency'] | undefined => {
  if (fields.currencyMode === 'fixed') {
    return { mode: 'fixed', currency: fields.fixedCurrency };
  }

  return fields.currencyColumn === undefined
    ? undefined
    : { mode: 'column', column: fields.currencyColumn };
};

// A structurally complete `ColumnMapping`, or `undefined` while a required
// field (date, its format, amount(s), description, currency) is still
// unmapped — the brief's own Import-disabled gate. `counterpartyColumn`
// (optional) never blocks this.
const buildColumnMapping = (fields: MappingFormFields): ColumnMapping | undefined => {
  if (
    fields.headerRowIndex === undefined ||
    fields.dateColumn === undefined ||
    fields.dateFormat === undefined ||
    fields.descriptionColumn === undefined
  ) {
    return undefined;
  }

  const amount = buildAmount(fields);
  const currency = buildCurrency(fields);

  if (amount === undefined || currency === undefined) {
    return undefined;
  }

  return {
    headerRowIndex: fields.headerRowIndex,
    delimiter: fields.delimiter,
    encoding: fields.encoding,
    decimalSeparator: fields.decimalSeparator,
    dateColumn: fields.dateColumn,
    dateFormat: fields.dateFormat,
    amount,
    descriptionColumn: fields.descriptionColumn,
    currency,
    counterpartyColumn: fields.counterpartyColumn,
  };
};

type MappedResult = {
  statement: ReturnType<typeof applyColumnMapping>['statement'];
  rowErrors: ColumnMappingRowError[];
};

// `applyColumnMapping` throws only when a `currency: { mode: 'column' }`
// mapping resolves NO row's currency at all (its own doc comment) — degrades
// to the same "nothing to show yet" state the incomplete-mapping case
// already renders, rather than crashing the screen.
const applyMappingSafely = (
  rows: TableCell[][],
  mapping: ColumnMapping,
): MappedResult | undefined => {
  try {
    return applyColumnMapping(rows, mapping);
  } catch {
    return undefined;
  }
};

const cellText = (cell: TableCell | undefined): string => (cell === undefined ? '' : String(cell));

const columnOptionsFor = (headerRow: TableCell[]): ColumnSelectFieldOption<number>[] =>
  headerRow.map((cell, index) => {
    const text = cellText(cell).trim();

    return { value: index, label: text === '' ? `#${index + 1}` : text };
  });

const dateFormatOptions: ColumnSelectFieldOption<DateFormatId>[] = dateFormatIds.map((id) => ({
  value: id,
  label: id,
}));

// Literal technical labels, not translated — the same treatment the
// delimiter pills give a bare "," / ";" (only "Tab", which has no visible
// symbol, gets a translated label).
const encodingLabel = (encoding: Encoding): string =>
  encoding === 'utf-8' ? 'UTF-8' : 'Windows-1251';

const delimiterLabel = (translate: TFunction, delimiter: TableDelimiter): string =>
  delimiter === '\t' ? translate('columnMapping.delimiterTab') : delimiter;

// The literal set of every key `loadStateMessageKey` can return, so `t()`
// still resolves a real, typed catalogue key (never a widened `string`) at
// the one call site that reads this.
type LoadStateMessageKey =
  | 'statementImport.reading'
  | 'statementImport.unrecognizedFormat'
  | 'columnMapping.xlsNotSupported';

// The i18n key for the ONE load-state message this screen shows outside the
// `ready` state, or `undefined` for `ready` itself (rendered separately, as
// the whole form) — collapses what would otherwise be 3 separate `&&`
// branches in the component's own render into 1, keeping that render under
// the project's Biome cognitive-complexity cap.
const loadStateMessageKey = (kind: LoadState['kind']): LoadStateMessageKey | undefined => {
  if (kind === 'loading') {
    return 'statementImport.reading';
  }

  if (kind === 'unreadable') {
    return 'statementImport.unrecognizedFormat';
  }

  if (kind === 'xlsNotSupported') {
    return 'columnMapping.xlsNotSupported';
  }

  return undefined;
};

// Every form field a saved mapping pre-fills, as a plain data object — kept
// separate from the `useEffect` below so that effect stays a straight-line
// sequence of setter calls (no embedded ternaries), under the same
// complexity cap.
type SavedFormState = {
  headerRowIndex: number;
  delimiter: TableDelimiter | undefined;
  encoding: Encoding;
  decimalSeparator: ',' | '.';
  dateColumn: number;
  dateFormat: DateFormatId;
  amountMode: AmountMode;
  amountColumn: number | undefined;
  debitColumn: number | undefined;
  creditColumn: number | undefined;
  descriptionColumn: number;
  currencyMode: CurrencyMode;
  currencyColumn: number | undefined;
  explicitFixedCurrency: Currency | undefined;
  counterpartyColumn: number | undefined;
};

const formStateFromSavedMapping = (mapping: SavedColumnMapping): SavedFormState => ({
  headerRowIndex: mapping.headerRowIndex,
  delimiter: mapping.delimiter,
  encoding: mapping.encoding ?? 'utf-8',
  decimalSeparator: mapping.decimalSeparator,
  dateColumn: mapping.dateColumn,
  dateFormat: mapping.dateFormat,
  amountMode: mapping.amount.mode,
  amountColumn: mapping.amount.mode === 'single' ? mapping.amount.column : undefined,
  debitColumn: mapping.amount.mode === 'debitCredit' ? mapping.amount.debitColumn : undefined,
  creditColumn: mapping.amount.mode === 'debitCredit' ? mapping.amount.creditColumn : undefined,
  descriptionColumn: mapping.descriptionColumn,
  currencyMode: mapping.currency.mode,
  currencyColumn: mapping.currency.mode === 'column' ? mapping.currency.column : undefined,
  explicitFixedCurrency: mapping.currency.mode === 'fixed' ? mapping.currency.currency : undefined,
  counterpartyColumn: mapping.counterpartyColumn,
});

/**
 * The generic column-mapping import screen (T6, docs/plans/statement-import.md
 * — see the shares-property-metals-debts P0 brief): lets a user map an
 * unrecognized (or bank-mismatched) statement's own columns onto the fields
 * every import needs, sharing `previewStats`/`useTargetHoldingOptions`/
 * `TargetHoldingSheet`/`ImportOutcome` with `statement-import.screen.tsx`.
 * Reads the file ONCE (`.xls` stops at `columnMapping.xlsNotSupported` and
 * renders nothing else); `findSavedMapping` pre-fills a known mapping on
 * load but NEVER imports on its own — the user always taps Import (Review
 * Focus 3), and a successful import saves the confirmed mapping back under
 * `mappingKeyFor(account.bankId, fingerprint)`.
 */
const ColumnMappingScreen: FC<ColumnMappingScreenProps> = ({ route, navigation }) => {
  const { filePath, accountId } = route.params;
  const { t } = useTranslation();

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [encoding, setEncoding] = useState<Encoding>('utf-8');
  const [delimiterOverride, setDelimiterOverride] = useState<TableDelimiter | undefined>(undefined);
  const [headerRowIndex, setHeaderRowIndex] = useState<number | undefined>(undefined);
  const [decimalSeparator, setDecimalSeparator] = useState<',' | '.'>('.');
  const [dateColumn, setDateColumn] = useState<number | undefined>(undefined);
  const [dateFormat, setDateFormat] = useState<DateFormatId | undefined>(undefined);
  const [amountMode, setAmountMode] = useState<AmountMode>('single');
  const [amountColumn, setAmountColumn] = useState<number | undefined>(undefined);
  const [debitColumn, setDebitColumn] = useState<number | undefined>(undefined);
  const [creditColumn, setCreditColumn] = useState<number | undefined>(undefined);
  const [descriptionColumn, setDescriptionColumn] = useState<number | undefined>(undefined);
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('fixed');
  const [currencyColumn, setCurrencyColumn] = useState<number | undefined>(undefined);
  const [explicitFixedCurrency, setExplicitFixedCurrency] = useState<Currency | undefined>(
    undefined,
  );
  const [counterpartyColumn, setCounterpartyColumn] = useState<number | undefined>(undefined);
  const [savedApplied, setSavedApplied] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [importResult, setImportResult] = useState<ImportResult | undefined>(undefined);

  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(accountId), ['accounts']);
  const account = accounts.at(0);
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const savedMappings = settingsRows.at(0)?.statementMappings;
  const holdingOptions = useTargetHoldingOptions(accountId);

  useEffect(() => {
    let cancelled = false;

    RNFS.readFile(filePath, 'base64')
      .then(async (base64) => {
        if (cancelled) {
          return;
        }

        const name = fileNameOf(filePath);

        if (isLegacyXlsFile(name)) {
          setLoadState({ kind: 'xlsNotSupported' });
          return;
        }

        if (isXlsxFile(name)) {
          const sheetRows = await readSheetRowsSafely(base64);

          if (!cancelled) {
            setLoadState({ kind: 'ready', fileName: name, isXlsx: true, base64, sheetRows });
          }

          return;
        }

        setLoadState({ kind: 'ready', fileName: name, isXlsx: false, base64 });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState({ kind: 'unreadable' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const tableInput = tableInputFor(loadState, encoding);
  const { rows, delimiter: detectedDelimiter } = tableInput
    ? readTableRows(tableInput, delimiterOverride)
    : { rows: [] as TableCell[][], delimiter: undefined };
  const effectiveDelimiter = delimiterOverride ?? detectedDelimiter;

  // Runs exactly once, the first time `rows` resolves: pre-fills a saved
  // mapping when one is found (Review Focus 3 — this only fills the FORM,
  // it never imports), or falls back to guessing the header row. Later
  // `rows` recomputations (an encoding/delimiter switch) never re-run this,
  // so the user's own picks are never clobbered.
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || rows.length === 0) {
      return;
    }

    initializedRef.current = true;
    const saved = findSavedMapping(savedMappings, account?.bankId, rows);

    if (saved === undefined) {
      setHeaderRowIndex(guessHeaderRowIndex(rows));
      return;
    }

    const state = formStateFromSavedMapping(saved.mapping);
    setHeaderRowIndex(state.headerRowIndex);
    setDelimiterOverride(state.delimiter);
    setEncoding(state.encoding);
    setDecimalSeparator(state.decimalSeparator);
    setDateColumn(state.dateColumn);
    setDateFormat(state.dateFormat);
    setAmountMode(state.amountMode);
    setAmountColumn(state.amountColumn);
    setDebitColumn(state.debitColumn);
    setCreditColumn(state.creditColumn);
    setDescriptionColumn(state.descriptionColumn);
    setCurrencyMode(state.currencyMode);
    setCurrencyColumn(state.currencyColumn);
    setExplicitFixedCurrency(state.explicitFixedCurrency);
    setCounterpartyColumn(state.counterpartyColumn);
    setSavedApplied(saved.exact);
  }, [rows, savedMappings, account?.bankId]);

  const defaultCurrency: Currency = holdings.at(0)?.currency ?? 'UAH';
  const fixedCurrency = explicitFixedCurrency ?? defaultCurrency;

  const headerRow = headerRowIndex !== undefined ? (rows[headerRowIndex] ?? []) : [];
  const columnOptions = columnOptionsFor(headerRow);

  const mapping = buildColumnMapping({
    headerRowIndex,
    delimiter: effectiveDelimiter,
    encoding,
    decimalSeparator,
    dateColumn,
    dateFormat,
    amountMode,
    amountColumn,
    debitColumn,
    creditColumn,
    descriptionColumn,
    currencyMode,
    currencyColumn,
    fixedCurrency,
    counterpartyColumn,
  });
  const applyResult = mapping ? applyMappingSafely(rows, mapping) : undefined;
  const stats: PreviewStats | undefined = applyResult
    ? previewStats(applyResult.statement, t('columnMapping.title'))
    : undefined;
  const loadMessageKey = loadStateMessageKey(loadState.kind);

  const canImport =
    mapping !== undefined &&
    applyResult !== undefined &&
    applyResult.statement.transactions.length > 0 &&
    selectedHoldingId !== undefined &&
    !importing;

  const handleImport = async (): Promise<void> => {
    if (!canImport || !mapping || !applyResult || !selectedHoldingId) {
      return;
    }

    setImporting(true);
    setImportError(undefined);

    try {
      setImportResult(await importParsedStatement(applyResult.statement, selectedHoldingId));

      const fingerprint = headerFingerprint(rows[mapping.headerRowIndex] ?? []);
      const key = mappingKeyFor(account?.bankId, fingerprint);
      await settingsRepo.saveStatementMapping(key, {
        ...mapping,
        fingerprint,
        savedAt: Date.now(),
      });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen scroll>
      <Box gap={4} testID="column-mapping-content">
        {loadMessageKey !== undefined && (
          <Text variant="body" tone="textSecondary">
            {t(loadMessageKey, { formats: supportedFormatNames })}
          </Text>
        )}

        {loadState.kind === 'ready' && (
          <Box gap={3}>
            <Text variant="heading">{t('columnMapping.title')}</Text>

            {savedApplied && (
              <Text variant="body" tone="textSecondary">
                {t('columnMapping.savedApplied')}
              </Text>
            )}

            <Box gap={1}>
              <Text variant="body" tone="textSecondary">
                {t('columnMapping.rawPreview')}
              </Text>
              <RawPreview
                rows={rows}
                headerRowIndex={headerRowIndex}
                onSelectHeaderRow={setHeaderRowIndex}
              />
            </Box>

            {!loadState.isXlsx && (
              <Box gap={3}>
                <Box gap={1} testID="column-mapping-encoding" style={styles.fieldGroup}>
                  <Text variant="body">{t('columnMapping.encoding')}</Text>
                  <OptionPills<Encoding>
                    options={['utf-8', 'windows-1251']}
                    selected={encoding}
                    onSelect={setEncoding}
                    label={encodingLabel}
                  />
                </Box>

                <Box gap={1} testID="column-mapping-delimiter">
                  <Text variant="body">{t('columnMapping.delimiter')}</Text>
                  <OptionPills<TableDelimiter>
                    options={[',', ';', '\t']}
                    selected={effectiveDelimiter}
                    onSelect={setDelimiterOverride}
                    label={(option) => delimiterLabel(t, option)}
                    columns={3}
                  />
                </Box>
              </Box>
            )}

            <Box gap={1} testID="column-mapping-decimal-separator" style={styles.fieldGroup}>
              <Text variant="body">{t('columnMapping.decimalSeparator')}</Text>
              <OptionPills<',' | '.'>
                options={[',', '.']}
                selected={decimalSeparator}
                onSelect={setDecimalSeparator}
              />
            </Box>

            <Box gap={3} style={styles.fieldGroup}>
              <ColumnSelectField
                label={t('columnMapping.dateColumn')}
                options={columnOptions}
                selected={dateColumn}
                onSelect={setDateColumn}
                testID="column-mapping-date-column"
              />

              <ColumnSelectField
                label={t('columnMapping.dateFormat')}
                options={dateFormatOptions}
                selected={dateFormat}
                onSelect={setDateFormat}
                testID="column-mapping-date-format"
              />
            </Box>

            <Box gap={3} testID="column-mapping-amount-mode" style={styles.fieldGroup}>
              <AmountFields
                columnOptions={columnOptions}
                mode={amountMode}
                onModeChange={setAmountMode}
                amountColumn={amountColumn}
                onAmountColumnChange={setAmountColumn}
                debitColumn={debitColumn}
                onDebitColumnChange={setDebitColumn}
                creditColumn={creditColumn}
                onCreditColumnChange={setCreditColumn}
              />
            </Box>

            <Box style={styles.fieldGroup}>
              <ColumnSelectField
                label={t('columnMapping.descriptionColumn')}
                options={columnOptions}
                selected={descriptionColumn}
                onSelect={setDescriptionColumn}
                testID="column-mapping-description-column"
              />
            </Box>

            <Box gap={3} testID="column-mapping-currency-mode" style={styles.fieldGroup}>
              <CurrencyFields
                columnOptions={columnOptions}
                mode={currencyMode}
                onModeChange={setCurrencyMode}
                currencyColumn={currencyColumn}
                onCurrencyColumnChange={setCurrencyColumn}
                fixedCurrency={fixedCurrency}
                onFixedCurrencyChange={setExplicitFixedCurrency}
              />
            </Box>

            <Box style={styles.fieldGroup}>
              <ColumnSelectField
                label={t('columnMapping.counterpartyColumn')}
                options={columnOptions}
                selected={counterpartyColumn}
                onSelect={setCounterpartyColumn}
                allowNotUsed
                testID="column-mapping-counterparty-column"
              />
            </Box>

            <MappingResult stats={stats} rowErrors={applyResult?.rowErrors ?? []} />

            <Button
              variant="secondaryTonal"
              fullWidth={false}
              onPress={() => setSheetVisible(true)}
            >
              {t('statementImport.chooseHolding')}
            </Button>

            <Button variant="primary" onPress={handleImport} disabled={!canImport}>
              {t('statementImport.importButton')}
            </Button>

            <ImportOutcome error={importError} result={importResult} />
          </Box>
        )}
      </Box>

      <TargetHoldingSheet
        visible={sheetVisible}
        onDismiss={() => setSheetVisible(false)}
        holdings={holdingOptions}
        accountId={accountId}
        onSelect={setSelectedHoldingId}
        onCreateNew={() => navigation.navigate('HoldingForm', { accountId })}
      />
    </Screen>
  );
};

export default ColumnMappingScreen;
