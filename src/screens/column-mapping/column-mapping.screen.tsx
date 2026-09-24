import * as RNFS from 'react-native-fs';
import type { TFunction } from 'i18next';
import type { FC, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { View, Alert, type ScrollViewInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ChipRow from '../forms/chip-row';
import {
  dateFormatIds,
  dateFormatExamples,
  type TableCell,
  type ColumnMapping,
  type DateFormatId,
  type TableDelimiter,
  type SavedColumnMapping,
  type ColumnMappingRowError,
  readTableRows,
  mappingKeyFor,
  applyColumnMapping,
  findSavedMapping,
  headerFingerprint,
  guessHeaderRowIndex,
} from '../../statement-import/column-mapping';
import {
  scrollToField,
  useHeaderInset,
  type FieldInstance,
} from '../forms/scroll-to-field/scroll-to-field';
import { holdingsRepo } from '../../holdings/repo';
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
import type { Currency } from '../../currency/currency';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import { accountsRepo } from '../../accounts/accounts.repo';
import { settingsRepo } from '../../settings/settings.repo';
import Divider from '../../design-system/components/divider';
import FieldLabel from '../../design-system/components/field-label';
import type { AccountsStackParamList } from '../../navigation/types';
import { supportedFormatNames } from '../../statement-import/registry';
import ImportResultSheet from '../statement-import/import-result-sheet';
import TargetHoldingField from '../statement-import/target-holding-field';
import SegmentedControl from '../../design-system/components/segmented-control';
import type { SpreadsheetCellValue, StatementFormatInput } from '../../statement-import/parser';
import { previewStats, type PreviewStats } from '../statement-import/preview-stats/preview-stats';
import { importParsedStatement, type ImportResult } from '../../statement-import/import-statement';
import { useTargetHoldingOptions } from '../statement-import/use-target-holding-options/use-target-holding-options';

import RawPreview from './raw-preview';
import AmountFields from './amount-fields';
import MappingResult from './mapping-result';
import CurrencyFields from './currency-fields';
import { styles } from './column-mapping.styles';
import ColumnSelectField from './column-select-field';
import type { AmountMode } from './amount-fields/amount-fields.props';
import type { CurrencyMode } from './currency-fields/currency-fields.props';
import type { ColumnSelectFieldOption } from './column-select-field/column-select-field.props';

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
// unmapped — read by `handleImport`'s own on-press validation. Import is
// ALWAYS enabled, never a standing `disabled={!isValid}` gate — see
// `kiko-code-style`'s "Form validation model". `counterpartyColumn`
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

// The wrapper refs `firstInvalidColumnMappingFieldRef` below picks a scroll
// target from — grouped into its own type so that function's own signature
// reads as one param per concern, mirroring `holding-form.screen.tsx`'s own
// `ValidatedFieldRefs`. `amountGroupFieldRef`/`currencyGroupFieldRef` each
// wrap their WHOLE field group (single-vs-debit/credit, column-vs-fixed) —
// there are up to 3 fields inside one group depending on the picked mode, and
// landing the scroll on the group reads just as well as a fourth ref per
// sub-field.
type ColumnMappingFieldRefs = {
  dateColumnFieldRef: RefObject<FieldInstance | null>;
  dateFormatFieldRef: RefObject<FieldInstance | null>;
  amountGroupFieldRef: RefObject<FieldInstance | null>;
  currencyGroupFieldRef: RefObject<FieldInstance | null>;
  descriptionColumnFieldRef: RefObject<FieldInstance | null>;
  // Wraps the Result block itself — the scroll target when every required
  // field IS mapped and the mapping applied without throwing, but zero rows
  // survived their own per-row checks (no single INPUT field is at fault).
  resultFieldRef: RefObject<FieldInstance | null>;
  targetHoldingFieldRef: RefObject<FieldInstance | null>;
};

// Every field-level Import-press validation message — module-level and
// pure, the same reason `firstInvalidFieldRef` in
// `holding-form.screen.tsx` is, so this branching stays out of the screen
// component's own cognitive-complexity budget. Computed FRESH on every
// render AND read directly inside `handleImport` (never gated on
// `attemptedImport` itself, mirroring `holding-form.screen.tsx`'s own
// `termDepositReasonKey()`/`bondReasonKey()`) — the screen component decides
// whether to DISPLAY these messages (`attemptedImport ? errors :
// NO_COLUMN_MAPPING_ERRORS`), matching the shared "validate on press" form
// model (`kiko-code-style`).
type ColumnMappingFieldErrors = {
  dateColumnError: string | undefined;
  dateFormatError: string | undefined;
  amountColumnError: string | undefined;
  debitColumnError: string | undefined;
  creditColumnError: string | undefined;
  currencyColumnError: string | undefined;
  descriptionColumnError: string | undefined;
  // Every required field IS mapped and `applyColumnMapping` succeeded, but
  // literally zero rows survived their own per-row checks — no single INPUT
  // field is at fault, so this is the Result block's own error instead of
  // one of the fields above.
  noRowsResolvedError: string | undefined;
  targetHoldingError: string | undefined;
};

// Every field pre-press, all unset — `Partial` + `{}` rather than 8 hand-
// listed `undefined`s, since every field is ALREADY `string | undefined`.
const NO_COLUMN_MAPPING_ERRORS: Partial<ColumnMappingFieldErrors> = {};

// Split out of `columnMappingFieldErrors` (below) purely to stay under
// Biome's cognitive-complexity cap — the currency field's error has 2
// independent reasons (missing, or mapped but unresolvable) layered on top
// of the "only in column mode" gate every other field-specific check here
// already has inline.
const currencyColumnErrorFor = (params: {
  t: TFunction;
  currencyMode: CurrencyMode;
  currencyColumn: number | undefined;
  currencyColumnUnresolved: boolean;
}): string | undefined => {
  const { t, currencyMode, currencyColumn, currencyColumnUnresolved } = params;

  if (currencyMode !== 'column') {
    return undefined;
  }

  if (currencyColumn === undefined) {
    return t('columnMapping.currencyColumnError');
  }

  return currencyColumnUnresolved ? t('columnMapping.currencyColumnUnresolvedError') : undefined;
};

const columnMappingFieldErrors = (params: {
  t: TFunction;
  dateColumn: number | undefined;
  dateFormat: DateFormatId | undefined;
  amountMode: AmountMode;
  amountColumn: number | undefined;
  debitColumn: number | undefined;
  creditColumn: number | undefined;
  currencyMode: CurrencyMode;
  currencyColumn: number | undefined;
  // True once every required field IS mapped but `applyColumnMapping` still
  // threw (a currency column whose values resolve to no known ISO code
  // anywhere in the file) — the ONE throw case that function's own doc
  // comment documents, so `mapping !== undefined && applyResult ===
  // undefined` (the caller's own check) is exactly this state, never a
  // false positive from some other per-row failure.
  currencyColumnUnresolved: boolean;
  descriptionColumn: number | undefined;
  // True once every required field IS mapped, `applyColumnMapping` succeeded
  // (so this is independent of `currencyColumnUnresolved` above, which is
  // the THROW case), but zero rows survived their own per-row checks.
  noRowsResolved: boolean;
  selectedHoldingId: string | undefined;
}): ColumnMappingFieldErrors => {
  const {
    t,
    dateColumn,
    dateFormat,
    amountMode,
    amountColumn,
    debitColumn,
    creditColumn,
    currencyMode,
    currencyColumn,
    currencyColumnUnresolved,
    descriptionColumn,
    noRowsResolved,
    selectedHoldingId,
  } = params;

  return {
    dateColumnError: dateColumn === undefined ? t('columnMapping.dateColumnError') : undefined,
    dateFormatError: dateFormat === undefined ? t('columnMapping.dateFormatError') : undefined,
    amountColumnError:
      amountMode === 'single' && amountColumn === undefined
        ? t('columnMapping.amountColumnError')
        : undefined,
    debitColumnError:
      amountMode === 'debitCredit' && debitColumn === undefined
        ? t('columnMapping.debitColumnError')
        : undefined,
    creditColumnError:
      amountMode === 'debitCredit' && creditColumn === undefined
        ? t('columnMapping.creditColumnError')
        : undefined,
    currencyColumnError: currencyColumnErrorFor({
      t,
      currencyMode,
      currencyColumn,
      currencyColumnUnresolved,
    }),
    descriptionColumnError:
      descriptionColumn === undefined ? t('columnMapping.descriptionColumnError') : undefined,
    noRowsResolvedError: noRowsResolved ? t('columnMapping.noRowsResolvedError') : undefined,
    targetHoldingError:
      selectedHoldingId === undefined ? t('statementImport.chooseHoldingError') : undefined,
  };
};

// The first still-invalid field's own ref, in the SAME top-to-bottom order
// the form renders its sections — `amountGroupFieldRef`/`currencyGroupFieldRef`
// each cover every sub-field their own mode can show (see
// `ColumnMappingFieldRefs`'s own doc comment).
const firstInvalidColumnMappingFieldRef = (
  errors: ColumnMappingFieldErrors,
  refs: ColumnMappingFieldRefs,
): RefObject<FieldInstance | null> | null => {
  const order: { invalid: boolean; ref: RefObject<FieldInstance | null> }[] = [
    { invalid: errors.dateColumnError !== undefined, ref: refs.dateColumnFieldRef },
    { invalid: errors.dateFormatError !== undefined, ref: refs.dateFormatFieldRef },
    {
      invalid:
        errors.amountColumnError !== undefined ||
        errors.debitColumnError !== undefined ||
        errors.creditColumnError !== undefined,
      ref: refs.amountGroupFieldRef,
    },
    { invalid: errors.currencyColumnError !== undefined, ref: refs.currencyGroupFieldRef },
    { invalid: errors.descriptionColumnError !== undefined, ref: refs.descriptionColumnFieldRef },
    { invalid: errors.noRowsResolvedError !== undefined, ref: refs.resultFieldRef },
    { invalid: errors.targetHoldingError !== undefined, ref: refs.targetHoldingFieldRef },
  ];
  const firstInvalid = order.find((entry) => entry.invalid);

  return firstInvalid ? firstInvalid.ref : null;
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

// True once the mapping applied without throwing but literally zero rows
// resolved to a transaction — whatever the reason (every row failed its own
// check, OR there were no data rows to begin with) — split out of the
// screen component purely to stay under Biome's cognitive-complexity cap.
const noRowsResolvedFor = (applyResult: MappedResult | undefined): boolean =>
  applyResult !== undefined && applyResult.statement.transactions.length === 0;

const cellText = (cell: TableCell | undefined): string => (cell === undefined ? '' : String(cell));

// True when a `currency: { mode: 'column' }` mapping's own column has zero
// non-empty cells across every data row — the reason `applyColumnMapping`
// throws in that case is "there is no data to read", not "the codes in this
// column aren't recognized", so the screen shows the no-rows error instead
// of a false currency-column complaint.
const currencyColumnIsBlank = (
  rows: TableCell[][],
  headerRowIndex: number,
  currencyColumn: number,
): boolean =>
  rows.slice(headerRowIndex + 1).every((row) => cellText(row[currencyColumn]).trim() === '');

type ColumnMappingResolutionState = {
  // `applyColumnMapping` throws ONLY when a `currency: { mode: 'column' }`
  // mapping resolves NO known code anywhere in the mapped currency column —
  // so once every required field IS structurally mapped (`mapping !==
  // undefined`) and the apply still failed (`applyResult === undefined`),
  // that is exactly this state, never a false positive from some other
  // per-row failure (see `applyColumnMapping`'s own doc comment) — EXCEPT a
  // blank currency column, which is really the no-rows case below.
  currencyColumnUnresolved: boolean;
  // Every required field IS mapped and the apply succeeded, but zero rows
  // resolved to a transaction (a date format that matches none of the
  // file's actual cells, say) — OR the apply THREW because the mapped
  // currency column had no data to read at all, which is also "nothing to
  // import", the same as a defined result with none.
  noRowsResolved: boolean;
};

// Both booleans above share `currencyColumnBlank` — split out of the screen
// component purely to stay under Biome's cognitive-complexity cap.
const resolutionStateFor = (
  rows: TableCell[][],
  mapping: ColumnMapping | undefined,
  applyResult: MappedResult | undefined,
): ColumnMappingResolutionState => {
  const currencyColumnBlank =
    mapping !== undefined &&
    mapping.currency.mode === 'column' &&
    currencyColumnIsBlank(rows, mapping.headerRowIndex, mapping.currency.column);

  return {
    currencyColumnUnresolved:
      mapping !== undefined &&
      applyResult === undefined &&
      mapping.currency.mode === 'column' &&
      !currencyColumnBlank,
    noRowsResolved: noRowsResolvedFor(applyResult) || currencyColumnBlank,
  };
};

const columnOptionsFor = (headerRow: TableCell[]): ColumnSelectFieldOption<number>[] =>
  headerRow.map((cell, index) => {
    const text = cellText(cell).trim();

    return { value: index, label: text === '' ? `#${index + 1}` : text };
  });

// Each option shows a worked example date (e.g. "31.12.2026 23:59:59"), not
// the raw preset id — meaningless to a user who doesn't already know
// date-format notation.
const dateFormatOptions: ColumnSelectFieldOption<DateFormatId>[] = dateFormatIds.map((id) => ({
  value: id,
  label: dateFormatExamples[id],
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
  // Forwarded to `MappingResult` — see that component's own `stats` doc
  // comment for why this gates the generic incomplete hint.
  mappingIncomplete: boolean;
  holdingOptions: ReturnType<typeof useTargetHoldingOptions>;
  accountId: string;
  selectedHoldingId: string | undefined;
  onSelectHolding: (holdingId: string) => void;
  onCreateNewHolding: () => void;
  // Import-press field-level errors — every field is `undefined` before the
  // first press, hence `Partial` rather than `ColumnMappingFieldErrors`
  // itself (see `NO_COLUMN_MAPPING_ERRORS`'s own doc comment).
  validation: Partial<ColumnMappingFieldErrors>;
  fieldRefs: ColumnMappingFieldRefs;
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
  mappingIncomplete,
  holdingOptions,
  accountId,
  selectedHoldingId,
  onSelectHolding,
  onCreateNewHolding,
  validation,
  fieldRefs,
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
      {savedApplied && (
        <Text variant="body" tone="textSecondary">
          {t('columnMapping.savedApplied')}
        </Text>
      )}

      <Box gap={3}>
        {/* A stronger, more visible hint (device-feedback-round-F1 item 12) —
            `heading` instead of the former muted `body`/`textSecondary`
            caption; this line doubles as the raw-preview section's own
            heading. */}
        <Text variant="heading">{t('columnMapping.rawPreview')}</Text>

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
        <Text variant="heading">{t('columnMapping.sectionFileFormat')}</Text>

        {!isXlsx && (
          <>
            <Box gap={1} testID="column-mapping-encoding">
              <FieldLabel label={t('columnMapping.encoding')} />

              <SegmentedControl<Encoding>
                options={['utf-8', 'windows-1251']}
                selected={encoding}
                onSelect={onEncodingChange}
                labels={encodingLabels}
                accessibilityLabel={t('columnMapping.encoding')}
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

        <Box gap={1} testID="column-mapping-decimal-separator">
          <FieldLabel label={t('columnMapping.decimalSeparator')} />

          <SegmentedControl<',' | '.'>
            options={[',', '.']}
            selected={decimalSeparator}
            onSelect={onDecimalSeparatorChange}
            accessibilityLabel={t('columnMapping.decimalSeparator')}
          />
        </Box>
      </Box>

      <Divider testID="column-mapping-divider-dates" />

      {/* Group (b): dates. */}
      <Box gap={3} style={styles.fieldGroup}>
        <Text variant="heading">{t('columnMapping.sectionDates')}</Text>

        <View ref={fieldRefs.dateColumnFieldRef}>
          <ColumnSelectField
            label={t('columnMapping.dateColumn')}
            options={columnOptions}
            selected={dateColumn}
            onSelect={onDateColumnChange}
            required
            placeholder={t('columnMapping.dateColumnPlaceholder')}
            error={validation.dateColumnError}
            testID="column-mapping-date-column"
          />
        </View>

        <View ref={fieldRefs.dateFormatFieldRef}>
          <ColumnSelectField
            label={t('columnMapping.dateFormat')}
            options={dateFormatOptions}
            selected={dateFormat}
            onSelect={onDateFormatChange}
            required
            placeholder={t('columnMapping.dateFormatPlaceholder')}
            error={validation.dateFormatError}
            testID="column-mapping-date-format"
          />
        </View>
      </Box>

      <Divider testID="column-mapping-divider-amounts" />

      {/* Group (c): amounts/currency. */}
      <View ref={fieldRefs.amountGroupFieldRef}>
        <Box gap={3} testID="column-mapping-amount-mode" style={styles.fieldGroup}>
          <Text variant="heading">{t('columnMapping.sectionAmount')}</Text>

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
            amountColumnError={validation.amountColumnError}
            debitColumnError={validation.debitColumnError}
            creditColumnError={validation.creditColumnError}
          />
        </Box>
      </View>

      <View ref={fieldRefs.currencyGroupFieldRef}>
        <Box gap={3} testID="column-mapping-currency-mode" style={styles.fieldGroup}>
          <Text variant="heading">{t('columnMapping.sectionCurrency')}</Text>

          <CurrencyFields
            columnOptions={columnOptions}
            mode={currencyMode}
            onModeChange={onCurrencyModeChange}
            currencyColumn={currencyColumn}
            onCurrencyColumnChange={onCurrencyColumnChange}
            fixedCurrency={fixedCurrency}
            onFixedCurrencyChange={onFixedCurrencyChange}
            currencyColumnError={validation.currencyColumnError}
          />
        </Box>
      </View>

      <Divider testID="column-mapping-divider-description" />

      {/* Group (d): description/counterparty/balance — moved to the bottom,
          in their own divided group (device-feedback-round-F1 item 10),
          now sharing ONE section heading (F3 item 14). */}
      <Box gap={3} style={styles.fieldGroup}>
        <Text variant="heading">{t('columnMapping.sectionDetails')}</Text>

        <View ref={fieldRefs.descriptionColumnFieldRef}>
          <ColumnSelectField
            label={t('columnMapping.descriptionColumn')}
            options={columnOptions}
            selected={descriptionColumn}
            onSelect={onDescriptionColumnChange}
            required
            placeholder={t('columnMapping.descriptionColumnPlaceholder')}
            error={validation.descriptionColumnError}
            testID="column-mapping-description-column"
          />
        </View>

        <ColumnSelectField
          label={t('columnMapping.counterpartyColumn')}
          options={columnOptions}
          selected={counterpartyColumn}
          onSelect={onCounterpartyColumnChange}
          allowNotUsed
          placeholder={t('columnMapping.counterpartyColumnPlaceholder')}
          testID="column-mapping-counterparty-column"
        />

        <ColumnSelectField
          label={t('columnMapping.balanceColumn')}
          options={columnOptions}
          selected={balanceColumn}
          onSelect={onBalanceColumnChange}
          allowNotUsed
          placeholder={t('columnMapping.balanceColumnPlaceholder')}
          testID="column-mapping-balance-column"
        />
      </Box>

      <Divider testID="column-mapping-divider-result" />

      {/* Group (e): result — MappingResult renders its OWN heading
          (`columnMapping.result`) in both its complete and incomplete
          states, at the same gap-driven spacing every other section uses. */}
      <View ref={fieldRefs.resultFieldRef}>
        <MappingResult
          stats={stats}
          rowErrors={rowErrors}
          holdingName={holdingOptions.find((holding) => holding.id === selectedHoldingId)?.name}
          noRowsResolvedError={validation.noRowsResolvedError}
          mappingIncomplete={mappingIncomplete}
        />
      </View>

      <View ref={fieldRefs.targetHoldingFieldRef}>
        <TargetHoldingField
          label={t('statementImport.chooseHolding')}
          required
          holdings={holdingOptions}
          accountId={accountId}
          selectedId={selectedHoldingId}
          onSelect={onSelectHolding}
          onCreateNew={onCreateNewHolding}
          placeholder={t('statementImport.chooseHoldingPlaceholder')}
          error={validation.targetHoldingError}
          testID="target-holding-field"
        />
      </View>
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
  const { filePath, accountId, holdingId, ownsFile } = route.params;
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
  const [importResult, setImportResult] = useState<ImportResult | undefined>(undefined);
  // N4 (F3 part 1 fix round 2): decoupled from `importResult` itself — see
  // `handleImportDone` below for why.
  const [resultSheetVisible, setResultSheetVisible] = useState(false);
  // R2-1 (F3 part 1 fix round 3): guards `handleSheetClosed` against running
  // its navigation more than once — see that function's own comment.
  const navigatedAwayRef = useRef(false);
  // Import is ALWAYS enabled — this flips true on the FIRST Import press
  // and stays true, the same "validate on press" contract every other Kiko
  // form uses (`kiko-code-style`'s "Form validation model").
  const [attemptedImport, setAttemptedImport] = useState(false);

  // The scroll-to-first-invalid-field infrastructure (mirrors
  // `holding-form.screen.tsx`): a ref per required field/field-group, plus
  // the ScrollView geometry `scrollToField` needs.
  const dateColumnFieldRef = useRef<FieldInstance>(null);
  const dateFormatFieldRef = useRef<FieldInstance>(null);
  const amountGroupFieldRef = useRef<FieldInstance>(null);
  const currencyGroupFieldRef = useRef<FieldInstance>(null);
  const descriptionColumnFieldRef = useRef<FieldInstance>(null);
  const resultFieldRef = useRef<FieldInstance>(null);
  const targetHoldingFieldRef = useRef<FieldInstance>(null);
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const headerInset = useHeaderInset();
  const contentHeightRef = useRef(0);

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

    // M8 (F3 part 1 fix round 1, Important) + N2 (fix round 2, Important):
    // `filePath` is a plaintext local cache copy (item 6's `keepLocalCopy`
    // fix) outside the encrypted database — deleted once this screen is
    // REMOVED from the stack, but ONLY when this screen actually OWNS the
    // file (`ownsFile`, set by `StatementImportScreen`'s T7 auto-`replace`
    // ONLY — see `navigation/types.d.ts`'s `ColumnMapping.ownsFile` doc
    // comment). When this screen was reached instead by "Map columns
    // manually" (a PUSH), `StatementImportScreen` stays mounted underneath
    // and still owns the file — deleting it here on a plain Back would
    // strand that still-reachable preview with a filePath that no longer
    // resolves, reintroducing item 6's exact bug (a second "Map columns
    // manually" tap re-reading a file this screen already deleted). The
    // preview's OWN unmount cleanup is the one that eventually deletes the
    // file in that case, once IT is genuinely done with the flow.
    return () => {
      cancelled = true;

      if (ownsFile) {
        deleteLocalStatementCopy(filePath);
      }
    };
  }, [filePath, ownsFile]);

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
  // A required column/date-format is still unset — the Result block's own
  // `columnMapping.incomplete` hint gate (see `MappingResult`'s own `stats`
  // doc comment for why a structurally complete mapping that merely failed
  // to APPLY never shows this hint).
  const mappingIncomplete = mapping === undefined;

  const { currencyColumnUnresolved, noRowsResolved } = resolutionStateFor(
    rows,
    mapping,
    applyResult,
  );

  // Computed FRESH on every render, never gated on `attemptedImport` itself
  // (see `ColumnMappingFieldErrors`'s own doc comment) — `handleImport` below
  // reads this SAME value directly for its scroll target, so it never lags
  // one render behind a just-set `attemptedImport`.
  const fieldErrors = columnMappingFieldErrors({
    t,
    dateColumn,
    dateFormat,
    amountMode,
    amountColumn,
    debitColumn,
    creditColumn,
    currencyMode,
    currencyColumn,
    currencyColumnUnresolved,
    descriptionColumn,
    noRowsResolved,
    selectedHoldingId,
  });
  const fieldRefs: ColumnMappingFieldRefs = {
    dateColumnFieldRef,
    dateFormatFieldRef,
    amountGroupFieldRef,
    currencyGroupFieldRef,
    descriptionColumnFieldRef,
    resultFieldRef,
    targetHoldingFieldRef,
  };
  // The DISPLAYED errors — `undefined` everywhere until the first Import
  // press, matching the shared "validate on press" form model.
  const validation = attemptedImport ? fieldErrors : NO_COLUMN_MAPPING_ERRORS;

  const canImport =
    mapping !== undefined &&
    applyResult !== undefined &&
    applyResult.statement.transactions.length > 0 &&
    selectedHoldingId !== undefined;

  // Import is ALWAYS enabled (`disabled={importing}` only, see the footer
  // below) — this validates on press instead of standing behind a
  // `disabled={!canImport}` gate, the shared form-validation model
  // (`kiko-code-style`). A blocked press flags every invalid field and
  // scrolls to the first one, exactly like `holding-form.screen.tsx`'s own
  // `save`.
  const handleImport = async (): Promise<void> => {
    if (importing) {
      return;
    }

    if (!canImport || !mapping || !applyResult || !selectedHoldingId) {
      setAttemptedImport(true);

      const target = firstInvalidColumnMappingFieldRef(fieldErrors, fieldRefs);

      if (target) {
        scrollToField(scrollableRef, target, {
          currentOffset: scrollOffset.value,
          headerInset,
          contentHeight: contentHeightRef.current,
        });
      }

      return;
    }

    setImporting(true);

    try {
      setImportResult(await importParsedStatement(applyResult.statement, selectedHoldingId));
      setResultSheetVisible(true);

      const fingerprint = headerFingerprint(rows[mapping.headerRowIndex] ?? []);
      const key = mappingKeyFor(account?.bankId, fingerprint);
      await settingsRepo.saveStatementMapping(key, {
        ...mapping,
        fingerprint,
        savedAt: Date.now(),
      });
    } catch {
      // A translated Alert, never raw `error.message` rendered inline — see
      // `statementImport.importErrorTitle`'s own doc comment.
      Alert.alert(t('statementImport.importErrorTitle'), t('statementImport.importErrorMessage'));
    } finally {
      setImporting(false);
    }
  };

  // Item 15 (F3): closes the successful-import modal. Does NOT navigate —
  // see `handleSheetClosed` below (R2-1, fix round 3) and its matching
  // comment on `statement-import.screen.tsx`'s own pair of handlers for the
  // full rationale. `importResult` itself is still never cleared (M4, fix
  // round 1).
  const handleImportDone = (): void => {
    setResultSheetVisible(false);
  };

  // R2-1 (F3 part 1 fix round 3): same shape as `statement-import.screen.tsx`'s
  // own `handleSheetClosed` — runs once `ImportResultSheet`'s `onClosed`
  // fires (the sheet's close animation actually finished), guarded by
  // `navigatedAwayRef` so a repeated call navigates at most once.
  // `navigation.popTo` — NOT `navigate`, which on React Navigation 7 pushes
  // a DUPLICATE of an already-on-stack route instead of reusing it (C1, F3
  // part 1 fix round 1 — see
  // `src/navigation/statement-import-return.navigator.test.tsx` for the
  // real-router proof) — finds the existing `AccountDetail` instance
  // already on the stack (this screen was pushed from StatementImport,
  // itself pushed FROM there) and pops back to it in one hop.
  const handleSheetClosed = (): void => {
    if (navigatedAwayRef.current) {
      return;
    }

    navigatedAwayRef.current = true;

    if (account) {
      navigation.popTo('AccountDetail', { accountId, name: account.name }, { merge: true });

      return;
    }

    navigation.goBack();
  };

  const footer =
    loadState.kind === 'ready' ? (
      // Import is ALWAYS enabled — `disabled={importing}` only, never a
      // standing `disabled={!canImport}` gate. See `handleImport`'s own doc
      // comment.
      <Button variant="primary" onPress={handleImport} disabled={importing}>
        {t('statementImport.importButton')}
      </Button>
    ) : undefined;

  return (
    <Screen
      scroll
      footer={footer}
      scrollableRef={scrollableRef}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
      }}
    >
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
            mappingIncomplete={mappingIncomplete}
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
            validation={validation}
            fieldRefs={fieldRefs}
          />
        )}
      </Box>

      <ImportResultSheet
        visible={resultSheetVisible}
        result={importResult}
        onDone={handleImportDone}
        onClosed={handleSheetClosed}
      />
    </Screen>
  );
};

export default ColumnMappingScreen;
