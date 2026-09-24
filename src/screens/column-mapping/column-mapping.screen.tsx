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
  deleteLocalStatementCopy,
} from '../../statement-import/read-statement-file';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Text from '../../design-system/components/text';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import Divider from '../../design-system/components/divider';
import { accountsRepo } from '../../accounts/accounts.repo';
import { settingsRepo } from '../../settings/settings.repo';
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
import ChipRow from '../forms/chip-row';
import ImportOutcome from '../statement-import/import-outcome';
import ImportResultSheet from '../statement-import/import-result-sheet';
import { previewStats, type PreviewStats } from '../statement-import/preview-stats/preview-stats';
import TargetHoldingField from '../statement-import/target-holding-field';
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
  balanceColumn: number | undefined;
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
    balanceColumn: fields.balanceColumn,
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
  balanceColumn: number | undefined;
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
  balanceColumn: mapping.balanceColumn,
});

// Every prop the `ready`-state form needs — a module-scope component
// (mirroring `statement-import.screen.tsx`'s own `StatementPreviewBlock`) so
// this large, mostly-static form tree doesn't count against the screen
// component's own cognitive-complexity budget. Groups sections with the
// shared `Divider` (device-feedback-round-F1, item 8): encoding/separators,
// dates, amounts/currency, description/counterparty (moved to the bottom,
// item 10), then the result.
type ColumnMappingFormProps = {
  isXlsx: boolean;
  savedApplied: boolean;
  rows: TableCell[][];
  headerRowIndex: number | undefined;
  onSelectHeaderRow: (rowIndex: number) => void;
  encoding: Encoding;
  onEncodingChange: (encoding: Encoding) => void;
  effectiveDelimiter: TableDelimiter | undefined;
  onDelimiterChange: (delimiter: TableDelimiter) => void;
  decimalSeparator: ',' | '.';
  onDecimalSeparatorChange: (separator: ',' | '.') => void;
  columnOptions: ColumnSelectFieldOption<number>[];
  dateColumn: number | undefined;
  onDateColumnChange: (value: number | undefined) => void;
  dateFormatOptions: ColumnSelectFieldOption<DateFormatId>[];
  dateFormat: DateFormatId | undefined;
  onDateFormatChange: (value: DateFormatId | undefined) => void;
  amountMode: AmountMode;
  onAmountModeChange: (mode: AmountMode) => void;
  amountColumn: number | undefined;
  onAmountColumnChange: (value: number | undefined) => void;
  debitColumn: number | undefined;
  onDebitColumnChange: (value: number | undefined) => void;
  creditColumn: number | undefined;
  onCreditColumnChange: (value: number | undefined) => void;
  currencyMode: CurrencyMode;
  onCurrencyModeChange: (mode: CurrencyMode) => void;
  currencyColumn: number | undefined;
  onCurrencyColumnChange: (value: number | undefined) => void;
  fixedCurrency: Currency;
  onFixedCurrencyChange: (currency: Currency) => void;
  descriptionColumn: number | undefined;
  onDescriptionColumnChange: (value: number | undefined) => void;
  counterpartyColumn: number | undefined;
  onCounterpartyColumnChange: (value: number | undefined) => void;
  balanceColumn: number | undefined;
  onBalanceColumnChange: (value: number | undefined) => void;
  stats: PreviewStats | undefined;
  rowErrors: ColumnMappingRowError[];
  holdingOptions: ReturnType<typeof useTargetHoldingOptions>;
  accountId: string;
  selectedHoldingId: string | undefined;
  onSelectHolding: (holdingId: string) => void;
  onCreateNewHolding: () => void;
  importError: string | undefined;
};

const ColumnMappingForm: FC<ColumnMappingFormProps> = ({
  isXlsx,
  savedApplied,
  rows,
  headerRowIndex,
  onSelectHeaderRow,
  encoding,
  onEncodingChange,
  effectiveDelimiter,
  onDelimiterChange,
  decimalSeparator,
  onDecimalSeparatorChange,
  columnOptions,
  dateColumn,
  onDateColumnChange,
  dateFormatOptions,
  dateFormat,
  onDateFormatChange,
  amountMode,
  onAmountModeChange,
  amountColumn,
  onAmountColumnChange,
  debitColumn,
  onDebitColumnChange,
  creditColumn,
  onCreditColumnChange,
  currencyMode,
  onCurrencyModeChange,
  currencyColumn,
  onCurrencyColumnChange,
  fixedCurrency,
  onFixedCurrencyChange,
  descriptionColumn,
  onDescriptionColumnChange,
  counterpartyColumn,
  onCounterpartyColumnChange,
  balanceColumn,
  onBalanceColumnChange,
  stats,
  rowErrors,
  holdingOptions,
  accountId,
  selectedHoldingId,
  onSelectHolding,
  onCreateNewHolding,
  importError,
}) => {
  const { t } = useTranslation();
  const encodingLabels: Partial<Record<Encoding, string>> = {
    'utf-8': encodingLabel('utf-8'),
    'windows-1251': encodingLabel('windows-1251'),
  };
  const delimiterLabels: Partial<Record<TableDelimiter, string>> = {
    ',': ',',
    ';': ';',
    '\t': delimiterLabel(t, '\t'),
  };

  return (
    <Box gap={3}>
      {/* The screen title itself is now the native stack header ONLY
          (`accounts.stack.tsx`'s `title: t('columnMapping.title')`) — this
          in-body heading used to duplicate it verbatim (F3 item 12,
          removed). Every section below carries its OWN heading instead
          (item 14), each at the same bottom margin the removed title had
          (item 13, `styles.sectionHeading`). */}
      {savedApplied && (
        <Text variant="body" tone="textSecondary">
          {t('columnMapping.savedApplied')}
        </Text>
      )}

      <Box>
        {/* A stronger, more visible hint (device-feedback-round-F1 item 12) —
            `heading` instead of the former muted `body`/`textSecondary`
            caption; this line doubles as the raw-preview section's own
            heading. */}
        <Box style={styles.sectionHeading}>
          <Text variant="heading">{t('columnMapping.rawPreview')}</Text>
        </Box>
        <RawPreview
          rows={rows}
          headerRowIndex={headerRowIndex}
          onSelectHeaderRow={onSelectHeaderRow}
        />
      </Box>

      <Divider testID="column-mapping-divider-encoding" />

      {/* Group (a): encoding/separators. Encoding/delimiter/decimal-separator
          all switched from the (too-large, device-feedback-round-F1 item 7)
          `OptionPills` chips to the app's existing compact `ChipRow`. */}
      <Box gap={3}>
        <Box style={styles.sectionHeading}>
          <Text variant="heading">{t('columnMapping.sectionFileFormat')}</Text>
        </Box>

        {!isXlsx && (
          <>
            <Box testID="column-mapping-encoding">
              <ChipRow<Encoding>
                label={t('columnMapping.encoding')}
                options={['utf-8', 'windows-1251']}
                selected={encoding}
                onSelect={onEncodingChange}
                labels={encodingLabels}
              />
            </Box>

            <Box testID="column-mapping-delimiter">
              <ChipRow<TableDelimiter>
                label={t('columnMapping.delimiter')}
                options={[',', ';', '\t']}
                selected={effectiveDelimiter ?? ','}
                onSelect={onDelimiterChange}
                labels={delimiterLabels}
              />
            </Box>
          </>
        )}

        <Box testID="column-mapping-decimal-separator">
          <ChipRow<',' | '.'>
            label={t('columnMapping.decimalSeparator')}
            options={[',', '.']}
            selected={decimalSeparator}
            onSelect={onDecimalSeparatorChange}
          />
        </Box>
      </Box>

      <Divider testID="column-mapping-divider-dates" />

      {/* Group (b): dates. */}
      <Box gap={3} style={styles.fieldGroup}>
        <Box style={styles.sectionHeading}>
          <Text variant="heading">{t('columnMapping.sectionDates')}</Text>
        </Box>

        <ColumnSelectField
          label={t('columnMapping.dateColumn')}
          options={columnOptions}
          selected={dateColumn}
          onSelect={onDateColumnChange}
          required
          testID="column-mapping-date-column"
        />

        <ColumnSelectField
          label={t('columnMapping.dateFormat')}
          options={dateFormatOptions}
          selected={dateFormat}
          onSelect={onDateFormatChange}
          required
          testID="column-mapping-date-format"
        />
      </Box>

      <Divider testID="column-mapping-divider-amounts" />

      {/* Group (c): amounts/currency. */}
      <Box gap={3} testID="column-mapping-amount-mode" style={styles.fieldGroup}>
        <Box style={styles.sectionHeading}>
          <Text variant="heading">{t('columnMapping.sectionAmount')}</Text>
        </Box>

        <AmountFields
          columnOptions={columnOptions}
          mode={amountMode}
          onModeChange={onAmountModeChange}
          amountColumn={amountColumn}
          onAmountColumnChange={onAmountColumnChange}
          debitColumn={debitColumn}
          onDebitColumnChange={onDebitColumnChange}
          creditColumn={creditColumn}
          onCreditColumnChange={onCreditColumnChange}
        />
      </Box>

      <Box gap={3} testID="column-mapping-currency-mode" style={styles.fieldGroup}>
        <Box style={styles.sectionHeading}>
          <Text variant="heading">{t('columnMapping.sectionCurrency')}</Text>
        </Box>

        <CurrencyFields
          columnOptions={columnOptions}
          mode={currencyMode}
          onModeChange={onCurrencyModeChange}
          currencyColumn={currencyColumn}
          onCurrencyColumnChange={onCurrencyColumnChange}
          fixedCurrency={fixedCurrency}
          onFixedCurrencyChange={onFixedCurrencyChange}
        />
      </Box>

      <Divider testID="column-mapping-divider-description" />

      {/* Group (d): description/counterparty/balance — moved to the bottom,
          in their own divided group (device-feedback-round-F1 item 10),
          now sharing ONE section heading (F3 item 14). */}
      <Box gap={3} style={styles.fieldGroup}>
        <Box style={styles.sectionHeading}>
          <Text variant="heading">{t('columnMapping.sectionDetails')}</Text>
        </Box>

        <ColumnSelectField
          label={t('columnMapping.descriptionColumn')}
          options={columnOptions}
          selected={descriptionColumn}
          onSelect={onDescriptionColumnChange}
          required
          testID="column-mapping-description-column"
        />

        <ColumnSelectField
          label={t('columnMapping.counterpartyColumn')}
          options={columnOptions}
          selected={counterpartyColumn}
          onSelect={onCounterpartyColumnChange}
          allowNotUsed
          testID="column-mapping-counterparty-column"
        />

        <ColumnSelectField
          label={t('columnMapping.balanceColumn')}
          options={columnOptions}
          selected={balanceColumn}
          onSelect={onBalanceColumnChange}
          allowNotUsed
          testID="column-mapping-balance-column"
        />
      </Box>

      <Divider testID="column-mapping-divider-result" />

      {/* Group (e): result — MappingResult renders its OWN heading
          (`columnMapping.result`), styled to the same section-heading
          margin internally (see mapping-result.styles.ts). */}
      <MappingResult stats={stats} rowErrors={rowErrors} />

      <TargetHoldingField
        label={t('statementImport.chooseHolding')}
        required
        holdings={holdingOptions}
        accountId={accountId}
        selectedId={selectedHoldingId}
        onSelect={onSelectHolding}
        onCreateNew={onCreateNewHolding}
        testID="target-holding-field"
      />

      <ImportOutcome error={importError} />
    </Box>
  );
};

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
  const { filePath, accountId, holdingId } = route.params;
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
  const [balanceColumn, setBalanceColumn] = useState<number | undefined>(undefined);
  const [savedApplied, setSavedApplied] = useState(false);

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

  // Items 2 + 11 (F3), merged into one field in fix round 1 (ponytail
  // review): `holdingId` covers BOTH the preview's prefill (item 11) and
  // the "Add new" holding return channel (item 2, via
  // `navigation.popTo(..., { merge: true })` — see `statement-import.screen.tsx`'s
  // matching effect and C1 for why `popTo`, not `navigate`). This ONE effect
  // handles both: it runs on mount (the prefill case) and again whenever
  // `holdingId` changes later (the create-and-return case).
  useEffect(() => {
    if (holdingId !== undefined) {
      setSelectedHoldingId(holdingId);
    }
  }, [holdingId]);

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

    // M8 (F3 part 1 fix round 1, Important): `filePath` is a plaintext local
    // cache copy (item 6's `keepLocalCopy` fix) outside the encrypted
    // database — deleted once this screen is REMOVED from the stack (a
    // successful import's `popTo`, or the user backing all the way out),
    // never left behind in `Library/Caches`. This screen never hands the
    // file off to another screen (unlike `StatementImportScreen`'s T7
    // auto-replace), so no replace-guard is needed here — every unmount is
    // a genuine "done with this file" event.
    return () => {
      cancelled = true;
      deleteLocalStatementCopy(filePath);
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
    setBalanceColumn(state.balanceColumn);
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
    balanceColumn,
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

  // Item 15 (F3): same shape as `statement-import.screen.tsx`'s own
  // `handleImportDone` — dismisses the successful-import modal and hands
  // control back to the account it was imported into. `navigation.popTo` —
  // NOT `navigate`, which on React Navigation 7 pushes a DUPLICATE of an
  // already-on-stack route instead of reusing it (C1, F3 part 1 fix round 1
  // — see `src/navigation/statement-import-return.navigator.test.tsx` for
  // the real-router proof) — finds the existing `AccountDetail` instance
  // already on the stack (this screen was pushed from StatementImport,
  // itself pushed FROM there) and pops back to it in one hop. Does NOT
  // clear `importResult` (M4, fix round 1) — see the matching comment on
  // `statement-import.screen.tsx`'s own `handleImportDone`.
  const handleImportDone = (): void => {
    if (account) {
      navigation.popTo('AccountDetail', { accountId, name: account.name }, { merge: true });

      return;
    }

    navigation.goBack();
  };

  const footer =
    loadState.kind === 'ready' ? (
      <Button variant="primary" onPress={handleImport} disabled={!canImport}>
        {t('statementImport.importButton')}
      </Button>
    ) : undefined;

  return (
    <Screen scroll footer={footer}>
      <Box gap={4} testID="column-mapping-content">
        {loadMessageKey !== undefined && (
          <Text variant="body" tone="textSecondary">
            {t(loadMessageKey, { formats: supportedFormatNames })}
          </Text>
        )}

        {loadState.kind === 'ready' && (
          <ColumnMappingForm
            isXlsx={loadState.isXlsx}
            savedApplied={savedApplied}
            rows={rows}
            headerRowIndex={headerRowIndex}
            onSelectHeaderRow={setHeaderRowIndex}
            encoding={encoding}
            onEncodingChange={setEncoding}
            effectiveDelimiter={effectiveDelimiter}
            onDelimiterChange={setDelimiterOverride}
            decimalSeparator={decimalSeparator}
            onDecimalSeparatorChange={setDecimalSeparator}
            columnOptions={columnOptions}
            dateColumn={dateColumn}
            onDateColumnChange={setDateColumn}
            dateFormatOptions={dateFormatOptions}
            dateFormat={dateFormat}
            onDateFormatChange={setDateFormat}
            amountMode={amountMode}
            onAmountModeChange={setAmountMode}
            amountColumn={amountColumn}
            onAmountColumnChange={setAmountColumn}
            debitColumn={debitColumn}
            onDebitColumnChange={setDebitColumn}
            creditColumn={creditColumn}
            onCreditColumnChange={setCreditColumn}
            currencyMode={currencyMode}
            onCurrencyModeChange={setCurrencyMode}
            currencyColumn={currencyColumn}
            onCurrencyColumnChange={setCurrencyColumn}
            fixedCurrency={fixedCurrency}
            onFixedCurrencyChange={setExplicitFixedCurrency}
            descriptionColumn={descriptionColumn}
            onDescriptionColumnChange={setDescriptionColumn}
            counterpartyColumn={counterpartyColumn}
            onCounterpartyColumnChange={setCounterpartyColumn}
            balanceColumn={balanceColumn}
            onBalanceColumnChange={setBalanceColumn}
            stats={stats}
            rowErrors={applyResult?.rowErrors ?? []}
            holdingOptions={holdingOptions}
            accountId={accountId}
            selectedHoldingId={selectedHoldingId}
            onSelectHolding={setSelectedHoldingId}
            onCreateNewHolding={() =>
              navigation.navigate('HoldingForm', {
                accountId,
                returnTo: { screen: 'ColumnMapping', params: route.params },
              })
            }
            importError={importError}
          />
        )}
      </Box>

      <ImportResultSheet
        visible={importResult !== undefined}
        result={importResult}
        onDone={handleImportDone}
      />
    </Screen>
  );
};

export default ColumnMappingScreen;
