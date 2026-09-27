import type { RefObject } from 'react';
import type {
  TableCell,
  DateFormatId,
  TableDelimiter,
  ColumnMappingRowError,
} from '@kiko/statement-import/column-mapping';
import type { Currency } from '@kiko/currency/currency';
import type { PreviewStats } from '@kiko/statement-import/preview-stats';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field/scroll-to-field';
import type { TargetHoldingOption } from '@kiko/design-system/components/target-holding-sheet/target-holding-sheet.props';

import type { AmountMode } from '../amount-fields/amount-fields.props';
import type { CurrencyMode } from '../currency-fields/currency-fields.props';
import type { ColumnSelectFieldOption } from '../column-select-field/column-select-field.props';

export type Encoding = 'utf-8' | 'windows-1251';

// The wrapper refs `firstInvalidColumnMappingFieldRef` (`column-mapping.screen.tsx`)
// picks a scroll target from — grouped into its own type so that function's own signature
// reads as one param per concern. `amountGroupFieldRef`/`currencyGroupFieldRef` each
// wrap their WHOLE field group (single-vs-debit/credit, column-vs-fixed) —
// there are up to 3 fields inside one group depending on the picked mode, and
// landing the scroll on the group reads just as well as a fourth ref per
// sub-field.
export type ColumnMappingFieldRefs = {
  dateColumnFieldRef: RefObject<FieldInstance | null>;
  dateFormatFieldRef: RefObject<FieldInstance | null>;
  amountGroupFieldRef: RefObject<FieldInstance | null>;
  currencyGroupFieldRef: RefObject<FieldInstance | null>;
  descriptionColumnFieldRef: RefObject<FieldInstance | null>;
  // Wraps the Result block itself — the scroll target whenever zero rows
  // survived (`noRowsResolved`, see `ColumnMappingResolutionState`'s own doc
  // comment), whether the apply succeeded with an empty result or threw on
  // a genuinely empty file — no single INPUT field is at fault either way.
  resultFieldRef: RefObject<FieldInstance | null>;
  targetHoldingFieldRef: RefObject<FieldInstance | null>;
};

// One error slot per column-mapping field, plus the Result block's own
// `noRowsResolvedError` and the holding picker's `targetHoldingError` — see
// `columnMappingFieldErrors` in `column-mapping.screen.tsx` for how each is
// computed.
export type ColumnMappingFieldErrors = {
  dateColumnError: string | undefined;
  dateFormatError: string | undefined;
  amountColumnError: string | undefined;
  debitColumnError: string | undefined;
  creditColumnError: string | undefined;
  currencyColumnError: string | undefined;
  descriptionColumnError: string | undefined;
  // Every required field IS mapped, but literally zero rows resolved to a
  // transaction — whether every row failed its own per-row check, the apply
  // succeeded with nothing to show, or the apply threw on a genuinely empty
  // file — no single INPUT field is at fault, so this is the Result block's
  // own error instead of one of the fields above.
  noRowsResolvedError: string | undefined;
  targetHoldingError: string | undefined;
};

export type ColumnMappingFormProps = {
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
  holdingOptions: TargetHoldingOption[];
  // Whether `holdingOptions` is still on its own first load — forwarded to
  // `TargetHoldingField` so the picker never opens on an incomplete/empty
  // list while its own queries are loading (kiko-architecture's
  // useLiveQuery consumer rule).
  holdingOptionsLoading: boolean;
  accountId: string;
  selectedHoldingId: string | undefined;
  onSelectHolding: (holdingId: string) => void;
  onCreateNewHolding: () => void;
  // Import-press field-level errors — every field is `undefined` before the
  // first press, hence `Partial` rather than `ColumnMappingFieldErrors`
  // itself (see `NO_COLUMN_MAPPING_ERRORS`'s own doc comment in
  // `column-mapping.screen.tsx`).
  validation: Partial<ColumnMappingFieldErrors>;
  fieldRefs: ColumnMappingFieldRefs;
};
