import { match } from 'ts-pattern';
import * as RNFS from 'react-native-fs';
import { useLiveQuery } from '@kiko/db';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import {
  scrollToField,
  useHeaderInset,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import {
  dateFormatIds,
  dateFormatExamples,
  type TableCell,
  type ColumnMapping,
  type DateFormatId,
  type TableDelimiter,
  type SourceTimeZoneId,
  type SavedColumnMapping,
  type ColumnMappingRowError,
  readTableRows,
  sourceTimeZoneOrKyiv,
  mappingKeyFor,
  applyColumnMapping,
  findSavedMapping,
  headerFingerprint,
  guessHeaderRowIndex,
} from '@kiko/statement-import/column-mapping';
import { holdingsRepo } from '@kiko/holdings/repo';
import {
  fileNameOf,
  isXlsxFile,
  isLegacyXlsFile,
  decodeStatementText,
  readSheetRowsSafely,
  deleteLocalStatementCopy,
} from '@kiko/statement-import/read-statement-file';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import type { ScrollViewInstance } from 'react-native';
import type { Currency } from '@kiko/currency/currency';
import either, { bifoldr, eitherSync } from 'fnts/either';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { supportedFormatNames } from '@kiko/statement-import/registry';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import ImportResultSheet from '@kiko/design-system/components/import-result-sheet';
import { type FC, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { previewStats, type PreviewStats } from '@kiko/statement-import/preview-stats';
import { useTargetHoldingOptions } from '@kiko/statement-import/use-target-holding-options';
import { useImportBalancePreview } from '@kiko/statement-import/use-import-balance-preview';
import type { SpreadsheetCellValue, StatementFormatInput } from '@kiko/statement-import/parser';
import { importParsedStatement, type ImportResult } from '@kiko/statement-import/import-statement';

import ColumnMappingForm from './column-mapping-form';
import type {
  Encoding,
  ColumnMappingFieldRefs,
  ColumnMappingFieldErrors,
} from './column-mapping-form/column-mapping-form.props';
import type { AmountMode } from './amount-fields/amount-fields.props';
import type { CurrencyMode } from './currency-fields/currency-fields.props';
import type { ColumnSelectFieldOption } from './column-select-field/column-select-field.props';

type ColumnMappingScreenProps = NativeStackScreenProps<AccountsStackParamList, 'ColumnMapping'>;

// The file-read pipeline's own state — kept separate from the derived
// mapping/preview below, mirroring `statement-import.screen.tsx`'s own
// `LoadState`, plus the `.xls`-specific terminal state this screen alone
// needs (and nothing else, once that state is reached).
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
  timeZone: SourceTimeZoneId;
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

const tableRowsFor = (
  loadState: LoadState,
  encoding: Encoding,
  delimiterOverride: TableDelimiter | undefined,
): ReturnType<typeof readTableRows> => {
  const tableInput = tableInputFor(loadState, encoding);

  return tableInput
    ? readTableRows(tableInput, delimiterOverride)
    : { rows: [], delimiter: undefined };
};

const buildAmount = (fields: MappingFormFields): ColumnMapping['amount'] | undefined => {
  if (fields.amountMode === 'single') {
    return foldMap(maybe(fields.amountColumn), (column) => ({ mode: 'single' as const, column }));
  }

  return fields.debitColumn === undefined || fields.creditColumn === undefined
    ? undefined
    : { mode: 'debitCredit', debitColumn: fields.debitColumn, creditColumn: fields.creditColumn };
};

const buildCurrency = (fields: MappingFormFields): ColumnMapping['currency'] | undefined => {
  if (fields.currencyMode === 'fixed') {
    return { mode: 'fixed', currency: fields.fixedCurrency };
  }

  return foldMap(maybe(fields.currencyColumn), (column) => ({ mode: 'column' as const, column }));
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
    timeZone: fields.timeZone,
    amount,
    descriptionColumn: fields.descriptionColumn,
    currency,
    counterpartyColumn: fields.counterpartyColumn,
    balanceColumn: fields.balanceColumn,
  };
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

// Every field-level Import-press validation message — module-level and pure,
// so this branching stays out of the screen component's own
// cognitive-complexity budget. Computed FRESH on every render and read
// directly inside `handleImport` (never gated on `attemptedImport` itself,
// mirroring the holding-form's own `termDepositReasonKey()`/`bondReasonKey()`)
// — the screen component decides whether to DISPLAY these messages
// (`attemptedImport ? errors : NO_COLUMN_MAPPING_ERRORS`), matching the
// shared "validate on press" form model (`kiko-code-style`).
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
  // threw on a currency column whose values resolve to no known ISO code —
  // as opposed to throwing because the file has no data rows at all, which
  // routes to `noRowsResolved` below instead (see `resolutionStateFor`'s own
  // `noDataRows` split).
  currencyColumnUnresolved: boolean;
  descriptionColumn: number | undefined;
  // True once every required field IS mapped, but zero rows resolved to a
  // transaction — whether the apply succeeded with nothing to show or threw
  // on a genuinely empty file (independent of `currencyColumnUnresolved`
  // above, which is the "real column, unresolvable values" case).
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
// mapping resolves NO row's currency at all (its own doc comment) — caught
// here so the screen renders its own "nothing resolved yet" state (an
// `undefined` `applyResult`) instead of crashing.
const applyMappingSafely = (
  rows: TableCell[][],
  mapping: ColumnMapping,
): MappedResult | undefined => {
  const attempt = eitherSync<unknown, MappedResult>(() => applyColumnMapping(rows, mapping));

  return bifoldr(attempt);
};

// True once the mapping applied without throwing but literally zero rows
// resolved to a transaction — whatever the reason (every row failed its own
// check, OR there were no data rows to begin with) — split out of the
// screen component purely to stay under Biome's cognitive-complexity cap.
const noRowsResolvedFor = (applyResult: MappedResult | undefined): boolean =>
  applyResult !== undefined && applyResult.statement.transactions.length === 0;

const cellText = (cell: TableCell | undefined): string => (cell === undefined ? '' : String(cell));

// True when NO data row in the file has ANY non-empty cell at all (a
// header-only export, or a saved header row picked at the very last line) —
// the one shape where there is genuinely nothing to import, so the Result
// block's own no-rows error is the right message. Narrower than "the
// CURRENCY column is blank": a file that has real data in its other columns
// but an empty currency column still blames the currency field itself (see
// `currencyColumnErrorFor`).
const noDataRowsIn = (rows: TableCell[][], headerRowIndex: number): boolean =>
  rows.slice(headerRowIndex + 1).every((row) => row.every((cell) => cellText(cell).trim() === ''));

type ColumnMappingResolutionState = {
  // `applyColumnMapping` throws ONLY when a `currency: { mode: 'column' }`
  // mapping resolves NO known code anywhere in the mapped currency column —
  // so once every required field IS structurally mapped (`mapping !==
  // undefined`) and the apply still failed (`applyResult === undefined`),
  // that is exactly this state, never a false positive from some other
  // per-row failure (see `applyColumnMapping`'s own doc comment) — EXCEPT
  // when the file has no data rows at all, which is really the no-rows case
  // below.
  currencyColumnUnresolved: boolean;
  // Every required field IS mapped and the apply succeeded, but zero rows
  // resolved to a transaction (a date format that matches none of the
  // file's actual cells, say) — OR the apply THREW because the file has no
  // data rows to read at all, which is also "nothing to import", the same
  // as a defined result with none.
  noRowsResolved: boolean;
};

// Both booleans above share `noDataRows` — split out of the screen
// component purely to stay under Biome's cognitive-complexity cap.
const resolutionStateFor = (
  rows: TableCell[][],
  mapping: ColumnMapping | undefined,
  applyResult: MappedResult | undefined,
): ColumnMappingResolutionState => {
  const noDataRows = mapping !== undefined && noDataRowsIn(rows, mapping.headerRowIndex);

  return {
    currencyColumnUnresolved:
      mapping !== undefined &&
      applyResult === undefined &&
      mapping.currency.mode === 'column' &&
      !noDataRows,
    noRowsResolved: noRowsResolvedFor(applyResult) || noDataRows,
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
  timeZone: SourceTimeZoneId;
  amountMode: AmountMode;
  amountColumn: number | undefined;
  debitColumn: number | undefined;
  creditColumn: number | undefined;
  descriptionColumn: number;
  currencyMode: CurrencyMode;
  currencyColumn: number | undefined;
  counterpartyColumn: number | undefined;
  balanceColumn: number | undefined;
};

const formStateFromSavedMapping = (mapping: SavedColumnMapping): SavedFormState => {
  const amountFields = match(mapping.amount)
    .with({ mode: 'single' }, (amount) => ({
      amountColumn: amount.column,
      debitColumn: undefined,
      creditColumn: undefined,
    }))
    .with({ mode: 'debitCredit' }, (amount) => ({
      amountColumn: undefined,
      debitColumn: amount.debitColumn,
      creditColumn: amount.creditColumn,
    }))
    // Not `.exhaustive()`: the original code read each field off its own
    // independent `mode === '…' ? … : undefined` ternary — an unrecognized
    // stored mode left every field undefined instead of throwing.
    .otherwise(() => ({
      amountColumn: undefined,
      debitColumn: undefined,
      creditColumn: undefined,
    }));
  // A saved fixed currency is not restored: a bank mapping is shared by every
  // account of that bank, and its currency belongs to the holding it was saved
  // for, so the fixed currency follows the target holding instead.
  const currencyColumn = match(mapping.currency)
    .with({ mode: 'column' }, (currency) => currency.column)
    // Not `.exhaustive()`: same reasoning as `amountFields` above — an
    // unrecognized stored mode leaves the column undefined.
    .otherwise(() => undefined);

  return {
    headerRowIndex: mapping.headerRowIndex,
    delimiter: mapping.delimiter,
    encoding: mapping.encoding ?? 'utf-8',
    decimalSeparator: mapping.decimalSeparator,
    dateColumn: mapping.dateColumn,
    dateFormat: mapping.dateFormat,
    timeZone: sourceTimeZoneOrKyiv(mapping.timeZone),
    amountMode: mapping.amount.mode,
    ...amountFields,
    descriptionColumn: mapping.descriptionColumn,
    currencyMode: mapping.currency.mode,
    currencyColumn,
    counterpartyColumn: mapping.counterpartyColumn,
    balanceColumn: mapping.balanceColumn,
  };
};

/**
 * The generic column-mapping import screen (see `docs/plans/statement-import.md`):
 * lets a user map an unrecognized (or bank-mismatched) statement's own
 * columns onto the fields every import needs, sharing
 * `previewStats`/`useTargetHoldingOptions`/`TargetHoldingSheet`/
 * `ImportOutcome` with `statement-import.screen.tsx`. Reads the file ONCE
 * (`.xls` stops at `columnMapping.xlsNotSupported` and renders nothing
 * else); `findSavedMapping` pre-fills a known mapping on load but NEVER
 * imports on its own — the user always taps Import, and a successful
 * import saves the confirmed mapping back under
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
  const [timeZone, setTimeZone] = useState<SourceTimeZoneId>('kyiv');
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

  const [pickedHoldingId, setPickedHoldingId] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | undefined>(undefined);
  // Decoupled from `importResult` itself — see
  // `handleImportDone` below for why.
  const [resultSheetVisible, setResultSheetVisible] = useState(false);
  // Guards `handleSheetClosed` against running
  // its navigation more than once — see that function's own comment.
  const navigatedAwayRef = useRef(false);
  // Import is ALWAYS enabled — this flips true on the FIRST Import press
  // and stays true, the same "validate on press" contract every other Kiko
  // form uses (`kiko-code-style`'s "Form validation model").
  const [attemptedImport, setAttemptedImport] = useState(false);

  // The scroll-to-first-invalid-field infrastructure (mirrors the
  // per-type `scrollTargets` each holding-form hook builds,
  // `holding-form/holding-type-form`): a ref per required field/field-group,
  // plus the ScrollView geometry `scrollToField` needs.
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

  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(
    accountsRepo.byIdQuery(accountId),
    ['accounts'],
  );
  const account = accounts.at(0);
  const { data: holdings } = useLiveQuery(holdingsRepo.listByAccountQuery(accountId), ['holdings']);
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(settingsRepo.getQuery(), [
    'settings',
  ]);
  const savedMappings = settingsRows.at(0)?.statementMappings;
  const { options: holdingOptions, isLoading: holdingOptionsLoading } =
    useTargetHoldingOptions(accountId);
  // Derived at render, never cleared in the `holdingId` effect below: the
  // options are a live query that can trail the `popTo` carrying a NEW holding's
  // id, so clearing a pick the list does not hold yet would drop a valid card.
  // A pick the list never holds (a ledgerless holding the form created) reads
  // as not selected, as the field already shows it.
  const selectedHoldingId = holdingOptions.some((option) => option.id === pickedHoldingId)
    ? pickedHoldingId
    : undefined;

  // `holdingId` covers BOTH the preview's prefill and
  // the "Add new" holding return channel, via
  // `navigation.popTo(..., { merge: true })` — see `statement-import.screen.tsx`'s
  // matching effect for why `popTo`, not `navigate`. This ONE effect
  // handles both: it runs on mount (the prefill case) and again whenever
  // `holdingId` changes later (the create-and-return case).
  useEffect(() => {
    if (holdingId !== undefined) {
      setPickedHoldingId(holdingId);
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

    // `filePath` is a plaintext local cache copy (`keepLocalCopy`'s own
    // fix) outside the encrypted database — deleted once this screen is
    // REMOVED from the stack, but ONLY when this screen actually OWNS the
    // file (`ownsFile`, set by `StatementImportScreen`'s auto-`replace`
    // ONLY — see `navigation/types/types.d.ts`'s `ColumnMapping.ownsFile` doc
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
        // deleteLocalStatementCopy swallows a failed unlink, and an unmount cleanup cannot await.
        // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
        deleteLocalStatementCopy(filePath);
      }
    };
  }, [filePath, ownsFile]);

  // Memoized, with the mapping and its result below, so the balance preview
  // keeps one statement until something it depends on changes: a new statement
  // is a new request.
  const { rows, delimiter: detectedDelimiter } = useMemo(
    () => tableRowsFor(loadState, encoding, delimiterOverride),
    [loadState, encoding, delimiterOverride],
  );
  const effectiveDelimiter = delimiterOverride ?? detectedDelimiter;

  // Runs exactly once, the first time `rows` resolves AND the account and
  // settings queries have loaded (both uncached, so the file can be read
  // first — the same wait `statement-import.screen.tsx`'s auto-replace check
  // makes): pre-fills a saved mapping when one is found (this only fills the
  // FORM, it never imports), or falls back to guessing the header row. Later
  // `rows` recomputations (an encoding/delimiter switch) never re-run this,
  // so the user's own picks are never clobbered.
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || rows.length === 0 || accountsLoading || settingsLoading) {
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
    setTimeZone(state.timeZone);
    setAmountMode(state.amountMode);
    setAmountColumn(state.amountColumn);
    setDebitColumn(state.debitColumn);
    setCreditColumn(state.creditColumn);
    setDescriptionColumn(state.descriptionColumn);
    setCurrencyMode(state.currencyMode);
    setCurrencyColumn(state.currencyColumn);
    setCounterpartyColumn(state.counterpartyColumn);
    setBalanceColumn(state.balanceColumn);
    setSavedApplied(saved.exact);
  }, [rows, savedMappings, account?.bankId, accountsLoading, settingsLoading]);

  // Import skips every row whose currency is not the target holding's, so in
  // fixed mode the target's own currency is the only default that imports.
  const targetCurrency = holdings.find((holding) => holding.id === selectedHoldingId)?.currency;
  const defaultCurrency: Currency = targetCurrency ?? holdings.at(0)?.currency ?? 'UAH';
  const fixedCurrency = explicitFixedCurrency ?? defaultCurrency;

  const headerRow = foldMap(maybe(headerRowIndex), (index) => rows[index] ?? []) ?? [];
  const columnOptions = columnOptionsFor(headerRow);

  const mapping = useMemo(
    () =>
      buildColumnMapping({
        headerRowIndex,
        delimiter: effectiveDelimiter,
        encoding,
        decimalSeparator,
        dateColumn,
        dateFormat,
        timeZone,
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
      }),
    [
      headerRowIndex,
      effectiveDelimiter,
      encoding,
      decimalSeparator,
      dateColumn,
      dateFormat,
      timeZone,
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
    ],
  );
  const applyResult = useMemo(
    () => foldMap(maybe(mapping), (mapped) => applyMappingSafely(rows, mapped)),
    [rows, mapping],
  );
  const balancePreview = useImportBalancePreview(applyResult?.statement, selectedHoldingId);
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
  // scrolls to the first one, the same `scrollTargets` pattern each
  // holding-form hook's own `save` uses.
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

      // The import has already committed; a failed save costs only next
      // time's pre-fill, so it must not reach the import-failure alert.
      await either(async () =>
        settingsRepo.saveStatementMapping(key, {
          ...mapping,
          fingerprint,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // A translated Alert, never raw `error.message` rendered inline — see
      // `statementImport.importErrorTitle`'s own doc comment.
      alertOnCatch(t, 'statementImport.importErrorTitle', 'statementImport.importErrorMessage');
    } finally {
      setImporting(false);
    }
  };

  // Closes the successful-import modal. Does NOT navigate —
  // see `handleSheetClosed` below and its matching
  // comment on `statement-import.screen.tsx`'s own pair of handlers for the
  // full rationale. `importResult` itself is still never cleared.
  const handleImportDone = (): void => {
    setResultSheetVisible(false);
  };

  // Same shape as `statement-import.screen.tsx`'s
  // own `handleSheetClosed` — runs once `ImportResultSheet`'s `onClosed`
  // fires (the sheet's close animation actually finished), guarded by
  // `navigatedAwayRef` so a repeated call navigates at most once.
  // `navigation.popTo` — NOT `navigate`, which on React Navigation 7 pushes
  // a DUPLICATE of an already-on-stack route instead of reusing it — see
  // `src/navigation/root-navigator/statement-import-return.navigator.test.tsx` for the
  // real-router proof) — finds the existing `AccountDetail` instance
  // already on the stack (this screen was pushed from StatementImport,
  // itself pushed FROM there) and pops back to it in one hop.
  const handleSheetClosed = (): void => {
    if (navigatedAwayRef.current) {
      return;
    }

    navigatedAwayRef.current = true;

    if (account) {
      navigation.popTo(
        'AccountDetail',
        { accountId, name: account.name, reminderOffer: 'afterImport' },
        { merge: true },
      );

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
            timeZone={timeZone}
            onTimeZoneChange={setTimeZone}
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
            balancePreview={balancePreview}
            holdingOptions={holdingOptions}
            holdingOptionsLoading={holdingOptionsLoading}
            accountId={accountId}
            selectedHoldingId={selectedHoldingId}
            onSelectHolding={setPickedHoldingId}
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
