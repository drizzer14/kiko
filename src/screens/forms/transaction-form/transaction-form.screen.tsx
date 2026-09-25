import {
  type FC,
  type ReactElement,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { ratesRepo } from '@kiko/rates/repo';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { categoriesRepo } from '@kiko/categories/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import { categoryOverridesRepo } from '@kiko/categories/category-overrides-repo';
import { type ScrollViewInstance, type TextInputInstance, View } from 'react-native';

import DateTimeRow from '../date-time-row';
import {
  canConvertToExchange,
  type ExchangeConvertDirection,
  exchangeConvertDirection,
} from '../../../holdings/exchange-convert';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';
import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
} from '../../../categories/category-display';
import CategoryField from '../category-field';
import { Money } from '../../../currency/money';
import {
  isExchangeCreateDestinationType,
  isExchangeCreateSourceType,
  isExchangeDestinationType,
  isExchangeSourceType,
} from '../../../holdings/exchange-destination';
import ExchangeFields from '../exchange-fields';
import ModeSelectField from '../mode-select-field';
import { parseAmount } from '../../../currency/parse';
import Box from '../../../design-system/components/box';
import HoldingSelectField from '../holding-select-field';
import { useLiveQuery } from '../../../db/use-live-query';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import { isSyncedHolding } from '../../../holdings/deletable';
import { buildRateTable } from '../../../rates/net-worth-view';
import ConvertExchangeFields from '../convert-exchange-fields';
import Divider from '../../../design-system/components/divider';
import DescriptionSuggestions from '../description-suggestions';
import SymbolIcon from '../../../design-system/components/symbol';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import TextField from '../../../design-system/components/text-field';
import { alertOnCatch } from '../../../design-system/alert-on-catch';
import { holdingTypeSymbol } from '../../../holdings/entity-symbols';
import { defaultHoldingColor } from '../../../holdings/entity-colors';
import FieldError from '../../../design-system/components/field-error';
import type { TransactionFormParams } from '../../../navigation/types';
import { resolveEntityColor } from '../../../design-system/entity-tint';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import { type Currency, currencySymbol } from '../../../currency/currency';
import type { FormMode } from '../mode-select-field/mode-select-field.props';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';
import { groupAmount, majorAmountText } from '../amount-format/amount-format';
import { seedCounterpartMinorUnits } from '../../../holdings/exchange-prefill';
import { normalizeTransactionName } from '../../../transactions/normalize-name';
import type { AccountRow, HoldingRow, TransactionRow } from '../../../db/schema';
import { defaultTransactionDescription } from '../../../transactions/default-description';
import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

// This screen is registered in BOTH the Home and Accounts stacks (Home lists
// every transaction; Accounts reaches it from a holding), so it cannot bind its
// props to a single stack's param list. It only needs the route params and two
// navigation methods, so it declares exactly that minimal shape — structurally
// satisfied by either stack's generated props.
type TransactionFormScreenProps = {
  route: { params: TransactionFormParams };
  navigation: { goBack: () => void; setOptions: (options: { title: string }) => void };
};

type Sign = 'income' | 'expense';

// The form's own mode (`FormMode`, imported from the mode-select-field the
// screen renders) is a superset of `Sign`: an Exchange is neither an income nor
// an expense row, so it gets its own branch through `save` (see `saveExchange`
// below) rather than trying to force it through the signed income/expense
// amount path.

// One change-return row of a split payment while it is being entered: the
// picked holding (null until chosen) and its still-unparsed major-amount text.
// `id` is a stable client key for the dynamic row list (mirrors the term-
// deposit contribution rows), never persisted.
type ChangeReturnRow = { id: number; holdingId: string | null; amount: string };

// The synced-row explanatory notice, or nothing on a manual/add row. Kept
// module-level (returns `ReactElement | null`) for the same cognitive-
// complexity-budget reason as `resolvePendingCategory` below: it moves this
// branch into the helper's own scope, out of the screen's returned JSX. The
// notice text is a catalog-resolved string, passed in rather than read from a
// module-level constant, so the helper stays translation-agnostic.
const renderReadOnlyNotice = (
  isReadOnly: boolean,
  surfaceHighColor: string,
  noticeText: string,
): ReactElement | null => {
  if (!isReadOnly) {
    return null;
  }

  return (
    <Box padding={3} style={[styles.notice, { backgroundColor: surfaceHighColor }]}>
      <Text variant="caption" tone="textSecondary">
        {noticeText}
      </Text>
    </Box>
  );
};

// The counterparty->comment column (item 10) writes a real value no screen
// ever surfaced (F3 device feedback item 17), shown whenever the loaded row
// carries a non-blank comment. Not gated by `isReadOnly`:
// `mapParsedTransaction`/Monobank sync can write `comment` onto any
// imported row regardless of `source`, and a Monobank-synced row is exactly
// the read-only case the brief calls out by name — so this renders for
// both. Module-level for the same cognitive-complexity-budget reason as
// `renderReadOnlyNotice` above.
//
// This does NOT reuse `SummaryTable`
// (the app's shared "label left, value right" ROW layout) — `SummaryTable`
// was built for short values (money, counts, dates); Comment is free text
// that can run to a full sentence. `SummaryTable` wraps a row's `value` in
// its OWN `Box` (`summary-table.component.tsx`'s `<Box
// testID={row.testID}>{row.value}</Box>`), one level BELOW the row's own
// flex-row layout — a `flexShrink`/`textAlign` set on the VALUE node I pass
// in (a grandchild of the row, not a direct flex child of it) has no effect
// on that row's own layout pass in Yoga; only the WRAPPING `Box` itself
// (which `SummaryTable` owns, not a caller) would need `flexShrink`, and
// the brief is explicit: do not change `SummaryTable`'s shared row for one
// caller. Stacking the label ABOVE the value instead — a plain `Box`
// column, not a flex row — sidesteps the problem entirely: the value
// `Text` gets the row's FULL width to itself and wraps normally, with no
// label competing for horizontal space on the same line.
const renderCommentRow = (
  comment: string | null | undefined,
  label: string,
): ReactElement | null => {
  const trimmed = comment?.trim();

  if (!trimmed) {
    return null;
  }

  return (
    <Box gap={1} testID="transaction-comment">
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>
      <Text variant="body">{trimmed}</Text>
    </Box>
  );
};

// The header title reflects the mode: a synced row is a plain read-only view, an
// existing manual row is an edit, and no id at all is a fresh add. The three
// candidate titles are catalog-resolved strings, passed in as a labels object
// rather than read from a module-level constant, so the helper stays
// translation-agnostic.
const headerTitle = (
  isReadOnly: boolean,
  isEditing: boolean,
  labels: { readOnly: string; editing: string; adding: string },
): string => {
  if (isReadOnly) {
    return labels.readOnly;
  }

  return isEditing ? labels.editing : labels.adding;
};

// The trailing currency glyph for the holding a leg targets, looked up by id:
// the holding's own currency symbol, or an empty string when no holding is
// selected yet (so a not-yet-known currency shows no symbol, never a wrong
// one). Used for the Exchange Value-In leg and the convert counterpart leg,
// whose currency comes from a picked holding rather than the source holding.
const holdingSuffix = (holdings: readonly HoldingRow[], holdingId: string | null): string => {
  const holding = holdings.find((candidate) => candidate.id === holdingId);

  return holding ? currencySymbol[holding.currency] : '';
};

const signedMinorUnits = (currency: Currency, amount: string, sign: Sign): number => {
  const magnitude = Money.fromMajor(currency, parseAmount(amount));

  return sign === 'expense' ? -magnitude.minorUnits : magnitude.minorUnits;
};

// The description field's placeholder: a preview of the label the row would
// carry if its description is left blank — the same holding-name + sign
// fallback the Home and Holding-detail lists render for an empty description
// (see `defaultTransactionDescription`). Only the polarity of the sign matters
// to that helper, so the current `mode` maps to a representative signed value
// (a negative for expense, non-negative otherwise). Falls back to a concrete
// example ("Coffee") when no holding has resolved yet, so there is nothing to
// preview — an example the user can type, not an echo of the field's own label.
// Kept module-level and pure so its branch stays out of the screen
// component's cognitive-complexity budget; `t` is the full `TFunction` (both
// the fallback and the interpolated preview flow through it). Both `expense`
// and `split` are expenses (a split's payment is negative), so each maps to a
// negative representative value and previews the expense-style fallback; only a
// plain income maps to non-negative.
const resolveDescriptionPlaceholder = (
  holding: Pick<HoldingRow, 'name'> | undefined,
  mode: FormMode,
  t: TFunction,
): string =>
  holding !== undefined
    ? defaultTransactionDescription(
        holding.name,
        mode === 'expense' || mode === 'split' ? -1 : 0,
        t,
      )
    : t('forms.transaction.descriptionPlaceholder');

// Whether a money field holds a strictly positive number — the same guard every
// `save` path applies before it writes. `parseAmount` yields NaN for a blank,
// whitespace, or junk field, and `NaN > 0` is false, so one comparison covers
// every rejected case (the same idiom as `contribution-form`'s `canSave`).
const isPositiveAmountText = (text: string): boolean => parseAmount(text) > 0;

// The rule-matched category for a typed description, or null when no rule
// matches or the normalized name is blank. Matching is JS-normalized (never
// SQL), the same normalize-then-match the sync insert path uses. Kept module-
// level and pure so the description-blur branch stays out of the screen
// component's cognitive-complexity budget.
const ruleCategoryFor = (
  description: string,
  categoryByNormalizedName: ReadonlyMap<string, string>,
): string | null => {
  const key = normalizeTransactionName(description);

  return key === '' ? null : (categoryByNormalizedName.get(key) ?? null);
};

// Whether the footer's Save button is disabled, per mode — each branch mirrors
// exactly what that mode's `save` path validates before it writes:
// - convert: a counterpart holding picked AND a positive counterpart amount.
// - exchange: a destination picked AND a positive Value Out AND Value In.
// - read-only (synced) row: never disabled here — Save only appears once the
//   category changed (`showsSaveButton`), and its write touches only the
//   category, never the bank-owned amount.
// - edit (manual): a positive amount; the category is optional on an edit.
// - fresh add: a positive amount AND a category.
// Kept module-level and pure (a params object, not a long positional list) so
// its branch count stays out of the screen component's cognitive-complexity
// budget.
type SaveDisabledParams = {
  converting: boolean;
  isExchange: boolean;
  isSplit: boolean;
  isReadOnly: boolean;
  isEditing: boolean;
  amount: string;
  valueIn: string;
  counterpartAmount: string;
  destinationHoldingId: string | null;
  counterpartHoldingId: string | null;
  selectedCategory: string | null;
  changeReturns: readonly { holdingId: string | null; amount: string }[];
  currency: Currency;
};

// The field key each save-blocking condition below belongs to.
type SaveDisabledField =
  | 'counterpartHolding'
  | 'counterpartAmount'
  | 'destinationHolding'
  | 'valueOut'
  | 'valueIn'
  | 'selectedCategory'
  | 'splitReturns'
  | 'amount';

// Every field's OWN independent error, gated only by which mode is ACTIVE
// (converting/isExchange/isSplit/plain are mutually exclusive, so only one
// of these ever renders at a time), typed to hold ONLY the active mode's own
// field keys — a mode's function never even mentions a field it has no
// opinion on, so there is no all-undefined record to keep in sync by hand.
type TransactionFieldErrors = Partial<Record<SaveDisabledField, string>>;

// Every field's OWN independent error for the convert mode.
const convertingFieldErrors = (
  params: SaveDisabledParams,
  t: TFunction,
): TransactionFieldErrors => ({
  counterpartHolding:
    params.counterpartHoldingId === null
      ? t('forms.transaction.selectCounterpartError')
      : undefined,
  counterpartAmount: isPositiveAmountText(params.counterpartAmount)
    ? undefined
    : t('forms.transaction.counterpartAmountError'),
});

// Every field's OWN independent error for the exchange mode.
const exchangeFieldErrors = (params: SaveDisabledParams, t: TFunction): TransactionFieldErrors => ({
  destinationHolding:
    params.destinationHoldingId === null
      ? t('forms.transaction.selectDestinationError')
      : undefined,
  valueOut: isPositiveAmountText(params.amount) ? undefined : t('forms.transaction.valueOutError'),
  valueIn: isPositiveAmountText(params.valueIn) ? undefined : t('forms.transaction.valueInError'),
});

// Every field's OWN independent error for the split mode. Split gates on the
// same invariant `saveSplit` writes: a positive payment and ≥1 distinct
// non-payer positive return whose sum stays below it, PLUS a category — a
// split expense's netted magnitude lands in the spending pie, so it must be
// categorised like any other create expense.
const splitFieldErrors = (params: SaveDisabledParams, t: TFunction): TransactionFieldErrors => ({
  selectedCategory:
    params.selectedCategory === null ? t('forms.transaction.selectCategoryError') : undefined,
  splitReturns: canSaveSplit(params.amount, params.changeReturns, params.currency)
    ? undefined
    : t('forms.transaction.splitInvalidError'),
});

// Every field's OWN independent error for the read-only/editing/fresh-add
// modes — a fresh add's amount and category are two SEPARATE fields, so
// both show at once instead of the category error waiting for amount to
// clear first. A read-only (synced) row is never blocked here: Save only
// appears once the category changed (`showsSaveButton`), and its write
// touches only the category, never the bank-owned amount.
const plainFieldErrors = (params: SaveDisabledParams, t: TFunction): TransactionFieldErrors => {
  if (params.isReadOnly) {
    return {};
  }

  return {
    amount: isPositiveAmountText(params.amount) ? undefined : t('forms.transaction.amountError'),
    selectedCategory:
      params.isEditing || params.selectedCategory !== null
        ? undefined
        : t('forms.transaction.selectCategoryError'),
  };
};

// Dispatches to the ACTIVE mode's own independent errors.
const transactionFieldErrors = (
  params: SaveDisabledParams,
  t: TFunction,
): TransactionFieldErrors => {
  if (params.converting) {
    return convertingFieldErrors(params, t);
  }

  if (params.isExchange) {
    return exchangeFieldErrors(params, t);
  }

  if (params.isSplit) {
    return splitFieldErrors(params, t);
  }

  return plainFieldErrors(params, t);
};

// Each mode's own field keys, in the SAME priority order that mode's own
// error function above tests them — `firstInvalidField` below finds the
// first of these with an actual error, which is both the Save-block gate
// AND the scroll-to-first-invalid target, so the two can never disagree.
const CONVERTING_FIELD_ORDER: readonly SaveDisabledField[] = [
  'counterpartHolding',
  'counterpartAmount',
];
const EXCHANGE_FIELD_ORDER: readonly SaveDisabledField[] = [
  'destinationHolding',
  'valueOut',
  'valueIn',
];
const SPLIT_FIELD_ORDER: readonly SaveDisabledField[] = ['selectedCategory', 'splitReturns'];
const PLAIN_FIELD_ORDER: readonly SaveDisabledField[] = ['amount', 'selectedCategory'];

// The active mode's own priority order — mirrors `transactionFieldErrors`'s
// dispatcher exactly, so the two can never pick a different mode's fields.
const activeFieldOrder = (params: SaveDisabledParams): readonly SaveDisabledField[] => {
  if (params.converting) {
    return CONVERTING_FIELD_ORDER;
  }

  if (params.isExchange) {
    return EXCHANGE_FIELD_ORDER;
  }

  if (params.isSplit) {
    return SPLIT_FIELD_ORDER;
  }

  return PLAIN_FIELD_ORDER;
};

// The first still-invalid field in priority order, or null once every field
// in that order has cleared.
const firstInvalidField = (
  order: readonly SaveDisabledField[],
  errors: TransactionFieldErrors,
): SaveDisabledField | null => order.find((key) => errors[key] !== undefined) ?? null;

// Whether `save` needs to raise the propagation-confirm sheet, and with what
// payload: only when the category actually changed AND the affected name is
// non-blank. `upsertCategoryOverride` refuses to write a rule for a blank
// normalized name (it must not become a catch-all), so confirming propagation
// for one asked `Apply "Groceries" to all transactions named ""?` and then
// wrote nothing — the row's own category is already persisted by `writeManual`
// regardless, so `save` just returns to the list instead. Kept module-level
// and pure for the same cognitive-complexity-budget reason as
// `transactionFieldErrors`.
const resolveCategoryOverrideRequest = (
  categoryChanged: boolean,
  selectedCategory: string | null,
  name: string,
): { name: string; category: string } | null => {
  if (!categoryChanged || selectedCategory === null || normalizeTransactionName(name) === '') {
    return null;
  }

  return { name, category: selectedCategory };
};

// The mode row's options: Exchange is a CREATE-ONLY mode, offered only from a
// cash source on create (`isExchangeCreateSourceType` — Requirement B,
// narrower than the wider `isExchangeSourceType`/`isExchangeDestinationType`
// pair in `holdings/exchange-destination`, reserved for convert-mode) — an
// edit always opens on `income` or `expense` (no editing an already-recorded
// exchange here). Kept module-level for the same cognitive-complexity-budget
// reason as `buildExchangeOptions` below.
const resolveModeOptions = (
  isEditing: boolean,
  holding: Pick<HoldingRow, 'type'> | undefined,
): readonly FormMode[] => {
  const canExchange =
    !isEditing && holding !== undefined && isExchangeCreateSourceType(holding.type);

  // Split-change is offered from the SAME liquid-source create rule as Exchange
  // (a fresh manual create off a cash payer), so the two extra modes appear and
  // disappear together. Split is inherently an expense (the payment is negative)
  // and, like Exchange, never surfaces on an edit or a synced row.
  return canExchange ? ['income', 'expense', 'exchange', 'split'] : ['income', 'expense'];
};

// The SF Symbol shown for each transaction type (the select trigger's glyph
// and each sheet row's leading icon). Note the deliberate, spec-mandated
// asymmetry: expense points UP and income points DOWN (money leaving vs.
// arriving). `split`'s `arrow.trianglehead.branch` is an iOS-26 symbol —
// SymbolIcon supplies its `arrow.branch` fallback centrally, so no fallback is
// threaded through the select here.
const MODE_ICONS: Record<FormMode, string> = {
  income: 'arrow.down',
  expense: 'arrow.up',
  exchange: 'arrow.left.arrow.right',
  split: 'arrow.trianglehead.branch',
};

// Whether a split payment + its returns are writable: a positive payment, at
// least one return, each return a positive amount on a DISTINCT holding, and Σ
// returns strictly less than |payment| (the net stays an expense). The payer
// holding IS an allowed return target (item 2): its balance nets the payment and
// the return with no double-count, so a return on the payer is valid — which is
// why the guard no longer takes a `payerHoldingId` to exclude. Same-currency
// returns only for v1 (enforced by the picker's filter). This is the ENFORCEMENT
// point for the distinct-holding/positive-amount invariant —
// `recordManualWithReturns` has no runtime guard — so it is exported and unit-
// tested directly (the picker's own filter makes a duplicate pick UI-unreachable,
// but a future caller or refactor must still be caught here).
export const canSaveSplit = (
  paymentAmount: string,
  returns: readonly { holdingId: string | null; amount: string }[],
  currency: Currency,
): boolean => {
  const payment = parseAmount(paymentAmount);

  if (Number.isNaN(payment) || payment <= 0 || returns.length === 0) {
    return false;
  }

  // Compare Σ returns against the payment in INTEGER minor units, via the exact
  // same conversion the write uses (`Money.fromMajor`), so a boundary case can
  // never disagree with what `saveSplit` records because of float-major math.
  const paymentMinor = Money.fromMajor(currency, payment).minorUnits;
  const ids = new Set<string>();
  let sumMinor = 0;

  // The payer is no longer rejected here (item 2) — only a null pick and a
  // duplicate holding are.
  for (const change of returns) {
    const value = parseAmount(change.amount);

    if (change.holdingId === null) {
      return false;
    }

    if (ids.has(change.holdingId)) {
      return false;
    }

    if (Number.isNaN(value) || value <= 0) {
      return false;
    }

    ids.add(change.holdingId);
    sumMinor += Money.fromMajor(currency, value).minorUnits;
  }

  return sumMinor < paymentMinor;
};

// The return-row picker's options: every OPEN holding in the payer's own
// currency (v1 keeps a split single-currency), except any holding already
// picked in ANOTHER row and except a synced/syncable holding (item 6 — a sync
// owns that holding's balance, so it can never be a return target). The payer
// holding IS an allowed return target (item 2): the net stays an expense and
// the balance nets on the payer with no double-count, so nothing is excluded by
// id here (`undefined` keeps `buildExchangeOptions` from dropping the payer).
// The eligible-TYPE gate is open (`() => true`) — a change return can land on
// any holding type. Whether a holding is synced is the shared `isSyncedHolding`
// predicate (its account is connected to a sync AND it carries that source's
// metadata key), mirrored here rather than reinvented.
const buildReturnOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  accountById: ReadonlyMap<string, AccountRow>,
  payerCurrency: Currency,
  pickedElsewhere: ReadonlySet<string>,
): HoldingSelectOption[] => {
  const syncableIds = new Set(
    holdings
      .filter((candidate) => isSyncedHolding(candidate, accountById.get(candidate.accountId)))
      .map((candidate) => candidate.id),
  );

  return buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    undefined,
    () => true,
  ).filter(
    (option) =>
      option.currency === payerCurrency &&
      !pickedElsewhere.has(option.id) &&
      !syncableIds.has(option.id),
  );
};

// Order two holdings the way the Accounts screen shows them (F2): primary by
// the parent account's display rank (its 0-based index in the sortOrder-ordered
// `accountsRepo.listQuery` list), then by the holding's own `sortOrder`, then
// `createdAt`. A holding whose account is not in the rank map sorts last, so a
// missing rank never reorders known accounts. Kept module-level and pure so
// `buildExchangeOptions` stays a plain filter/sort/map chain.
const compareByAccountThenHolding = (
  first: HoldingRow,
  second: HoldingRow,
  accountOrderById: ReadonlyMap<string, number>,
): number => {
  const firstRank = accountOrderById.get(first.accountId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = accountOrderById.get(second.accountId) ?? Number.MAX_SAFE_INTEGER;

  if (firstRank !== secondRank) {
    return firstRank - secondRank;
  }

  if (first.sortOrder !== second.sortOrder) {
    return first.sortOrder - second.sortOrder;
  }

  return first.createdAt - second.createdAt;
};

// Every OPEN, non-excluded holding except `excludeHoldingId`, projected to a
// picker option carrying its parent account name (Requirement C), ordered to
// match the Accounts screen (F2 — see `compareByAccountThenHolding`). The
// eligible TYPE test is injected by the caller so one builder serves create-mode
// (cash-only) and both convert-mode directions (the wider rules) without
// duplicating the projection. A closed holding is excluded so an exchange can
// never fund a holding the user has already closed out. Kept module-level (a
// pure projection of `holdings` + the account maps) so the component body's
// cognitive-complexity budget is spent on the render branching, not this list
// construction.
const buildExchangeOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  excludeHoldingId: string | undefined,
  isEligibleType: (type: HoldingRow['type']) => boolean,
): HoldingSelectOption[] => {
  return holdings
    .filter(
      (candidate) =>
        candidate.id !== excludeHoldingId &&
        candidate.closedAt == null &&
        isEligibleType(candidate.type),
    )
    .sort((first, second) => compareByAccountThenHolding(first, second, accountOrderById))
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      icon: candidate.icon ?? holdingTypeSymbol[candidate.type],
      color: resolveEntityColor(candidate.color, defaultHoldingColor[candidate.type]),
      currency: candidate.currency,
      accountName: accountNameById.get(candidate.accountId) ?? '',
    }));
};

// Whether a holding TYPE takes a plain manual transaction — the same gate
// `holdingDetailSpecs` (`holding-detail-spec/`) applies for its `'transaction'`
// action: a ledgerless type (term_deposit, bond, property_item — see
// `isLedgerlessHoldingType`) carries no manual ledger and is excluded;
// everything else (cash/card/crypto_asset/jar) is eligible. Mirrored here
// (rather than imported from that spec) so the primary picker and the
// footer action agree without a cross-feature import.
const isTransactionEligibleType = (type: HoldingRow['type']): boolean =>
  !isLedgerlessHoldingType(type);

// The primary-leg picker's options for the global-add (empty-create) case:
// every OPEN, non-synced, transaction-eligible holding (mirroring the
// `'transaction'` gate above), projected and Accounts-ordered by the shared
// `buildExchangeOptions`. A synced holding's ledger is owned by its sync, so it
// can never be a manual-create target — excluded here the same way
// `buildReturnOptions` drops syncable holdings.
const buildPrimaryOptions = (
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  accountById: ReadonlyMap<string, AccountRow>,
): HoldingSelectOption[] => {
  const syncableIds = new Set(
    holdings
      .filter((candidate) => isSyncedHolding(candidate, accountById.get(candidate.accountId)))
      .map((candidate) => candidate.id),
  );

  return buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    undefined,
    isTransactionEligibleType,
  ).filter((option) => !syncableIds.has(option.id));
};

// The id to seed the primary-holding seam with on the empty-create path, or
// null when there is nothing to seed yet (not an empty create, already seeded/
// picked, the query still loading, or no eligible holding at all). Prefers the
// user's most-recent MANUAL holding when it is still eligible, else the first
// Accounts-ordered eligible option. Gating the whole decision on
// `primaryHoldingId === null` makes it a one-shot seed that a later live refresh
// (or an in-progress user pick, which also makes the seam non-null) can never
// clobber. Kept module-level and pure so the seeding effect stays a thin
// dispatch and this branch chain stays out of the screen's cognitive-complexity
// budget.
const resolveDefaultPrimaryHolding = (args: {
  isEmptyCreate: boolean;
  primaryHoldingId: string | null;
  latestManualLoading: boolean;
  latestManualHoldingId: string | null;
  options: readonly HoldingSelectOption[];
}): string | null => {
  const { isEmptyCreate, primaryHoldingId, latestManualLoading, latestManualHoldingId, options } =
    args;

  if (!isEmptyCreate || primaryHoldingId !== null || latestManualLoading || options.length === 0) {
    return null;
  }

  const recentIsEligible =
    latestManualHoldingId !== null && options.some((option) => option.id === latestManualHoldingId);

  return recentIsEligible ? latestManualHoldingId : options[0].id;
};

// The primary-leg holding picker, rendered ONLY in the empty-create (global-add,
// B) case — the one mode where no holding is fixed by navigation, so the user
// picks the leg here (its currency/category/exchange eligibility then flow
// automatically through the shared `primaryHoldingId` seam). Returns null on
// every other path. Extracted to a module-level function (returns
// `ReactElement | null`) so the screen's JSX gates on a single call rather than
// its own `isEmptyCreate &&`, keeping that branch out of the component's
// cognitive-complexity budget — the same shape as `renderReadOnlyNotice`.
const renderPrimaryHoldingField = (props: {
  visible: boolean;
  label: string;
  placeholder: string;
  options: readonly HoldingSelectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): ReactElement | null => {
  if (!props.visible) {
    return null;
  }

  return (
    <HoldingSelectField
      label={props.label}
      placeholder={props.placeholder}
      options={props.options}
      selectedId={props.selectedId}
      onSelect={props.onSelect}
      required
    />
  );
};

// Present a stored (signed) minor-units amount as the unsigned major string the
// Amount input shows, pairing it with the sign chip the amount's polarity maps
// to. Kept pure so the hydration effect below stays a one-liner.
const toAmountFields = (
  currency: Currency,
  amountMinorUnits: number,
): { amount: string; sign: Sign } => {
  return {
    amount: majorAmountText(currency, amountMinorUnits),
    sign: amountMinorUnits < 0 ? 'expense' : 'income',
  };
};

// The three mutually-exclusive entry ids read once from the route params, so
// the component body spends no `in`-check branch on any of them (the union
// keeps at most one non-null). `holdingParamId` is the plain-add holding;
// `duplicateOfId` seeds a CREATE pre-filled from an existing manual row.
const readRouteEntry = (
  params: TransactionFormParams,
): {
  editingId: string | null;
  duplicateOfId: string | null;
  holdingParamId: string | null;
  // The empty-create (global-add, B) case: none of the three ids present, so
  // the form fixes no holding by navigation and renders its own primary-leg
  // picker. Derived here, in the same pure read, so the component spends no
  // boolean chain on it.
  isEmptyCreate: boolean;
} => {
  const editingId = 'transactionId' in params ? params.transactionId : null;
  const duplicateOfId =
    'duplicateOfTransactionId' in params ? params.duplicateOfTransactionId : null;
  const holdingParamId = 'holdingId' in params ? params.holdingId : null;

  return {
    editingId,
    duplicateOfId,
    holdingParamId,
    isEmptyCreate: editingId === null && duplicateOfId === null && holdingParamId === null,
  };
};

// The one-shot mount seeding plan, computed by a pure module-level helper so the
// screen's hydrate effect stays a thin dispatch (three flat `if`s) instead of
// carrying the edit-vs-duplicate branching in its own cognitive-complexity
// budget. `seedHolding` is the duplicate path's FIRST step — it seats the
// `primaryHoldingId` seam from the source row so the holding (hence its
// currency scale) resolves before the amount is formatted; `seedFields` is the
// terminal step both paths share. A `null` `time` means "leave the field at its
// current value" — the duplicate keeps NOW, never copying the source timestamp.
// `final` on `seedHolding` says whether seating the seam is the LAST step: the
// duplicate path leaves it open (`false`) so its follow-up `seedFields` step
// still runs, while the empty-create (B) default seed has nothing more to
// hydrate, so it closes the `hydrated` latch immediately (`true`) — stopping the
// effect from re-running every render (which otherwise raised overlapping-act
// churn) without adding a branch to the effect.
type HydrationPlan =
  | { kind: 'wait' }
  | { kind: 'seedHolding'; holdingId: string; final: boolean }
  | {
      kind: 'seedFields';
      amount: string;
      sign: Sign;
      description: string;
      category: string | null;
      time: number | null;
    };

const seedFieldsFrom = (
  currency: Currency,
  row: Pick<TransactionRow, 'amountMinorUnits' | 'description' | 'category'>,
  time: number | null,
): HydrationPlan => {
  const fields = toAmountFields(currency, row.amountMinorUnits);

  return {
    kind: 'seedFields',
    amount: groupAmount(fields.amount),
    sign: fields.sign,
    description: row.description,
    // Lowercase the stored value to a slug key — the same normalization the
    // display resolver applies — so it lines up with the picker's option keys.
    category: row.category ? row.category.toLowerCase() : null,
    time,
  };
};

const resolveHydration = (args: {
  existing: TransactionRow | undefined;
  duplicateSource: TransactionRow | undefined;
  holding: HoldingRow | undefined;
  primaryHoldingId: string | null;
  currency: Currency;
  // The empty-create (B) default holding to seat the seam with, already
  // resolved by `resolveDefaultPrimaryHolding` (null once seeded/picked, on a
  // non-empty-create path, or while the query is still loading). Seeds through
  // the SAME `seedHolding` step the duplicate path uses, so the empty-create
  // default rides the effect's own one-shot latch with no second effect.
  defaultPrimaryHoldingId: string | null;
}): HydrationPlan => {
  const {
    existing,
    duplicateSource,
    holding,
    primaryHoldingId,
    currency,
    defaultPrimaryHoldingId,
  } = args;

  // Edit: seed once both the row and its holding have loaded, carrying the
  // stored timestamp so a manual row round-trips its own time.
  if (existing && holding) {
    return seedFieldsFrom(currency, existing, existing.time);
  }

  if (duplicateSource) {
    // Duplicate step 1: seat the primary-holding seam from the source row so
    // its holding (and currency scale) resolves on the next render. NOT final —
    // step 2 (`seedFields`) still needs to run once the holding resolves.
    if (primaryHoldingId === null) {
      return { kind: 'seedHolding', holdingId: duplicateSource.holdingId, final: false };
    }

    // Duplicate step 2: seed the copied fields, dated to NOW (`time: null`).
    if (holding) {
      return seedFieldsFrom(currency, duplicateSource, null);
    }
  }

  // Empty-create (B): seat the primary seam from the most-recent-manual default
  // (else the first eligible option). Nothing else to hydrate — the fields stay
  // blank for a fresh add — so this is FINAL: it closes the `hydrated` latch so
  // the effect stops re-running, and a later live refresh can never clobber the
  // seam (the user's own pick goes straight through `setPrimaryHoldingId`).
  if (defaultPrimaryHoldingId !== null) {
    return { kind: 'seedHolding', holdingId: defaultPrimaryHoldingId, final: true };
  }

  return { kind: 'wait' };
};

// Convert-mode's derived view: eligibility, direction, the counterpart picker
// options, the read-only fixed side's display value, and the direction-
// dependent labels — bundled into one object so the component body spends a
// single call on all of it, rather than an eligibility `&&` chain plus a
// direction ternary plus a labels ternary each adding their own cognitive-
// complexity cost. Kept module-level and pure (given the loaded `existing`
// row, `holding`, and `holdings`) for the same budget reason as
// `buildExchangeOptions` above.
type ConvertView = {
  eligible: boolean;
  direction: ExchangeConvertDirection | null;
  options: HoldingSelectOption[];
  fixedValue: string;
  fixedLabel: string;
  counterpartLabel: string;
  counterpartAmountLabel: string;
};

const resolveConvertView = (
  existing: Pick<TransactionRow, 'amountMinorUnits'> | undefined,
  isEditing: boolean,
  holding: Pick<HoldingRow, 'type'> | undefined,
  currency: Currency,
  holdings: readonly HoldingRow[],
  accountNameById: ReadonlyMap<string, string>,
  accountOrderById: ReadonlyMap<string, number>,
  holdingId: string | undefined,
  t: TFunction,
): ConvertView => {
  // Convert-mode eligibility uses the WIDER (cash/card) rule, unchanged from
  // the current create source rule — Requirement B's cash-only restriction
  // applies to CREATE only. Both manual and synced rows qualify; the action
  // never mutates the existing row, so a synced row stays safe.
  const eligible =
    isEditing &&
    existing !== undefined &&
    holding !== undefined &&
    canConvertToExchange(holding.type, existing.amountMinorUnits);
  const direction = existing ? exchangeConvertDirection(existing.amountMinorUnits) : null;
  // An expense-sourced convert picks a DESTINATION (wider: excludes bond/jar);
  // an income-sourced convert picks a SOURCE (wider: cash/card only). Excludes
  // the existing holding and closed holdings, and carries account names
  // (Requirement C).
  const options = buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    holdingId,
    direction === 'record-source' ? isExchangeSourceType : isExchangeDestinationType,
  );
  // The fixed side's display value: the existing amount in the existing
  // holding's currency, formatted the same way the Amount input shows it.
  const fixedValue = existing
    ? groupAmount(toAmountFields(currency, existing.amountMinorUnits).amount)
    : '';
  // Expense source -> fixed side is Value Out, the user records a destination
  // (To/Value In). Income destination -> fixed side is Value In, the user
  // records a source (From/Value Out).
  const labels =
    direction === 'record-source'
      ? {
          fixedLabel: t('forms.transaction.valueIn'),
          counterpartLabel: t('forms.transaction.from'),
          counterpartAmountLabel: t('forms.transaction.valueOut'),
        }
      : {
          fixedLabel: t('forms.transaction.valueOut'),
          counterpartLabel: t('forms.transaction.to'),
          counterpartAmountLabel: t('forms.transaction.valueIn'),
        };

  return { eligible, direction, options, fixedValue, ...labels };
};

// The screen's main field group: convert-mode's single-counterpart group,
// Exchange's two-leg group, or income/expense's plain Amount/Description/Date
// group — exactly one of the three renders at a time. Extracted to its own
// module-level function (if/return rather than a nested ternary inline in the
// screen's JSX) so `noNestedTernary` stays satisfied and the screen
// component's own cognitive-complexity budget is spent on state and
// save/derive logic, not this three-way render switch.
type FieldGroupProps = {
  converting: boolean;
  convertView: ConvertView;
  counterpartHoldingId: string | null;
  onSelectCounterpart: (id: string) => void;
  counterpartAmount: string;
  onChangeCounterpartAmount: (text: string) => void;
  isExchange: boolean;
  amount: string;
  onChangeAmount: (text: string) => void;
  // The source holding's currency glyph, shown as the amount/Value-Out field's
  // suffix. Empty when no holding has resolved yet, so no wrong symbol shows.
  amountSuffix: string;
  destinationOptions: HoldingSelectOption[];
  destinationHoldingId: string | null;
  onSelectDestination: (id: string) => void;
  valueIn: string;
  onChangeValueIn: (text: string) => void;
  // The destination holding's currency glyph, shown as the Value-In field's
  // suffix. Empty until a destination is picked.
  valueInSuffix: string;
  // The convert group's two currency glyphs: the read-only fixed leg's own
  // currency, and the counterpart leg's currency (empty until one is picked).
  fixedSuffix: string;
  counterpartSuffix: string;
  description: string;
  onChangeDescription: (text: string) => void;
  // Fires when the description field loses focus — the A1 category auto-pick
  // (see `onDescriptionBlur` in the screen). Kept off `onChangeDescription`
  // (which stays a bare setter) so the lookup never runs on a keystroke.
  onBlurDescription: () => void;
  descriptionPlaceholder: string;
  // The inline description-suggestion row, rendered directly under the description field.
  // Null on an edit (an edit already has its description) or whenever there is
  // nothing to suggest — the component hides itself, so this is `ReactElement |
  // null` rather than a boolean gate here.
  descriptionSuggestions: ReactElement | null;
  isReadOnly: boolean;
  time: number;
  onChangeTime: (timestamp: number) => void;
  t: TFunction;
  // Per-field validation-failure messages and wrapper refs, threaded straight
  // into `ExchangeFields`/`ConvertExchangeFields` (the Task 8 props) or onto
  // the plain Amount `TextField` — see `fieldError`/`fieldRefsByKey` in the
  // screen component. `undefined` everywhere on a read-only row, where no
  // field ever gates Save.
  amountError?: string;
  amountFieldRef?: RefObject<FieldInstance | null>;
  // The plain Amount TextField's own inner input, so a blocked Save can
  // focus it imperatively once it has scrolled into view — see `save`'s
  // `onSettled` callback in the screen component. Only the plain (non-
  // exchange, non-converting) Amount field has one; the Exchange/Convert
  // legs are owned by their own sub-components.
  amountInputRef?: RefObject<TextInputInstance | null>;
  valueOutError?: string;
  destinationError?: string;
  valueInError?: string;
  valueOutFieldRef?: RefObject<FieldInstance | null>;
  destinationFieldRef?: RefObject<FieldInstance | null>;
  valueInFieldRef?: RefObject<FieldInstance | null>;
  counterpartError?: string;
  counterpartAmountError?: string;
  counterpartFieldRef?: RefObject<FieldInstance | null>;
  counterpartAmountFieldRef?: RefObject<FieldInstance | null>;
};

const renderFieldGroup = (props: FieldGroupProps): ReactElement => {
  if (props.converting) {
    return (
      <ConvertExchangeFields
        fixedLabel={props.convertView.fixedLabel}
        fixedValue={props.convertView.fixedValue}
        fixedSuffix={props.fixedSuffix}
        counterpartLabel={props.convertView.counterpartLabel}
        counterpartPlaceholder={props.t('forms.transaction.selectHolding')}
        counterpartOptions={props.convertView.options}
        counterpartHoldingId={props.counterpartHoldingId}
        onSelectCounterpart={props.onSelectCounterpart}
        counterpartAmountLabel={props.convertView.counterpartAmountLabel}
        counterpartAmount={props.counterpartAmount}
        onChangeCounterpartAmount={props.onChangeCounterpartAmount}
        counterpartSuffix={props.counterpartSuffix}
        time={props.time}
        onChangeTime={props.onChangeTime}
        counterpartError={props.counterpartError}
        counterpartAmountError={props.counterpartAmountError}
        counterpartFieldRef={props.counterpartFieldRef}
        counterpartAmountFieldRef={props.counterpartAmountFieldRef}
      />
    );
  }

  if (props.isExchange) {
    return (
      <ExchangeFields
        valueOut={props.amount}
        onChangeValueOut={props.onChangeAmount}
        valueOutSuffix={props.amountSuffix}
        destinationOptions={props.destinationOptions}
        destinationHoldingId={props.destinationHoldingId}
        onSelectDestination={props.onSelectDestination}
        valueIn={props.valueIn}
        onChangeValueIn={props.onChangeValueIn}
        valueInSuffix={props.valueInSuffix}
        time={props.time}
        onChangeTime={props.onChangeTime}
        valueOutError={props.valueOutError}
        destinationError={props.destinationError}
        valueInError={props.valueInError}
        valueOutFieldRef={props.valueOutFieldRef}
        destinationFieldRef={props.destinationFieldRef}
        valueInFieldRef={props.valueInFieldRef}
      />
    );
  }

  return (
    <>
      <View ref={props.amountFieldRef}>
        <TextField
          label={props.t('forms.fields.amount')}
          value={props.amount}
          onChangeText={props.onChangeAmount}
          editable={!props.isReadOnly}
          keyboardType="decimal-pad"
          placeholder={props.t('forms.transaction.amountPlaceholder')}
          suffix={props.amountSuffix}
          // A read-only (synced) row's amount never gates save, so it carries
          // no required marker; a manual add/edit always needs a positive
          // amount.
          required={!props.isReadOnly}
          error={props.amountError}
          inputRef={props.amountInputRef}
        />
      </View>

      <TextField
        label={props.t('forms.transaction.description')}
        value={props.description}
        onChangeText={props.onChangeDescription}
        onBlur={props.onBlurDescription}
        editable={!props.isReadOnly}
        placeholder={props.descriptionPlaceholder}
      />

      {/* The inline tap-to-fill suggestion row, directly under the
        description field. It hides itself when there is nothing to offer, so it
        is rendered unconditionally here. */}
      {props.descriptionSuggestions}

      <DateTimeRow
        time={props.time}
        onChangeTime={props.onChangeTime}
        disabled={props.isReadOnly}
        dateTestID="transaction-date-field"
        timeTestID="transaction-time-field"
      />
    </>
  );
};

// Split-change mode's dynamic section, rendered BELOW the reused Amount/
// Description/Date/Time group (income/expense's own field group already renders
// for split, since split is neither exchange nor converting): one row per
// change-return — a holding picker + a payer-currency amount field + a tonal
// Remove button — followed by an "Add return" action. Extracted to its own
// module-level function (a props object, not a positional list) for the same
// cognitive-complexity-budget reason as `renderFieldGroup` above.
type SplitReturnsProps = {
  // Whether the split section renders at all — false collapses it to null, so
  // the screen's JSX gates on a single call (not its own `isSplit &&`), keeping
  // that branch out of the component's cognitive-complexity budget.
  visible: boolean;
  returns: readonly ChangeReturnRow[];
  buildOptions: (index: number) => HoldingSelectOption[];
  onSelectHolding: (index: number, holdingId: string) => void;
  onChangeAmount: (index: number, text: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  // The payer holding's currency glyph, shown as every return amount's suffix
  // (v1 returns are payer-currency only).
  suffix: string;
  selectHoldingPlaceholder: string;
  t: TFunction;
  // The combined payment+returns validation-failure message, or `undefined`
  // when valid — rendered right after the mapped return rows, before the "Add
  // return" action, mirroring `TextField`'s own `error` contract even though
  // this reason covers the whole return list rather than one field.
  error?: string;
  // The LAST return row's own wrapper ref — a SEPARATE ref from
  // `splitReturnsFieldRef` (the CALL SITE's own wrapper, anchoring the whole
  // section for scroll-to-invalid) — so `addReturn` can scroll to whichever
  // row is newest, via the SAME occlusion-aware `scrollToField` helper
  // (round-6 device feedback item 3), rather than an unconditional
  // `scrollToEnd` that used to fire even when the new row was already fully
  // visible. `undefined` is a valid value (never passed while not split).
  lastRowRef?: RefObject<FieldInstance | null>;
};

const renderSplitReturns = (props: SplitReturnsProps): ReactElement | null => {
  if (!props.visible) {
    return null;
  }

  return (
    <>
      {/* A divider + title-case section heading mark where the change-returns
        list begins (item 4), the same shared Divider + `variant="heading"` Text
        the term-deposit contributions section uses. */}
      <Divider testID="returns-divider" />

      <Text variant="heading">{props.t('forms.transaction.returnsHeading')}</Text>

      {props.returns.map((row, index) => (
        <View
          key={row.id}
          // Only the LAST row anchors `lastRowRef` (round-6 item 3's
          // add-row scroll target) — `undefined` on every earlier row, the
          // same single-target-ref shape `contributionsFieldRef`'s own
          // index-gated assignment uses in holding-form.
          ref={index === props.returns.length - 1 ? props.lastRowRef : undefined}
        >
          <Box gap={2}>
            <HoldingSelectField
              label={props.t('forms.transaction.returnTo', { index: index + 1 })}
              placeholder={props.selectHoldingPlaceholder}
              options={props.buildOptions(index)}
              selectedId={row.holdingId}
              onSelect={(holdingId) => props.onSelectHolding(index, holdingId)}
              required
            />

            <TextField
              label={props.t('forms.transaction.returnAmount', { index: index + 1 })}
              value={row.amount}
              onChangeText={(text) => props.onChangeAmount(index, text)}
              keyboardType="decimal-pad"
              placeholder={props.t('forms.transaction.amountPlaceholder')}
              suffix={props.suffix}
              required
            />

            {/* The delete-return control reuses the SAME shared Button the deposit
              (term-deposit contributions) form uses for its remove action — a
              destructiveTonal small button WITH a text label — rather than the
              hand-rolled icon-only button it was before (item 3). Gated on more
              than one return, mirroring the contributions list's own guard, so
              the last remaining split return cannot be deleted. */}
            {props.returns.length > 1 && (
              <Button
                variant="destructiveTonal"
                size="small"
                fullWidth={false}
                icon="trash"
                accessibilityLabel={props.t('forms.transaction.removeReturn', { index: index + 1 })}
                onPress={() => props.onRemove(index)}
              >
                {props.t('forms.transaction.remove')}
              </Button>
            )}
          </Box>
        </View>
      ))}

      {props.error !== undefined && <FieldError message={props.error} />}

      <Button
        variant="secondaryTonal"
        size="small"
        fullWidth={false}
        icon="plus"
        onPress={props.onAdd}
      >
        {props.t('forms.transaction.addReturn')}
      </Button>
    </>
  );
};

// Whether the footer's Save button renders: a manual row always, a synced row
// only once its category has changed, and a converting row always (its Save
// writes the counterpart leg, never the existing row). Kept module-level and
// pure so the footer's boolean expression does not add its own operator count
// to the screen component's cognitive-complexity budget.
const showsSaveButton = (
  isReadOnly: boolean,
  categoryChanged: boolean,
  converting: boolean,
): boolean => !isReadOnly || categoryChanged || converting;

// The category picker and "Convert to exchange" action: everything below the
// main field group EXCEPT while converting (a convert has no category — just
// the convert group and Save). Deleting a transaction is offered only through
// the row's touch-and-hold context menu (`CardContextMenu`), not from this
// form. The transaction-TYPE selector is NOT here; it renders above the field
// group, under the Holding select. Extracted to its own module-level function
// for the same cognitive-complexity-budget reason as `renderFieldGroup`
// above: several independent `&&`-gated conditions, kept out of the screen
// component's own branch count.
type ModeAndActionsProps = {
  converting: boolean;
  isReadOnly: boolean;
  isExchange: boolean;
  categoryOptions: { key: string; title: string; icon: string; color: string }[];
  selectedCategory: string | null;
  onSelectCategory: (key: string) => void;
  convertEligible: boolean;
  onPressConvert: () => void;
  isEditing: boolean;
  t: TFunction;
  // The category picker's own validation-failure message, or `undefined` when
  // valid — rendered directly after the `CategoryField`, which is also
  // wrapped in `categoryFieldRef` for scroll-to-invalid.
  categoryError?: string;
  categoryFieldRef?: RefObject<FieldInstance | null>;
};

const renderModeAndActions = (props: ModeAndActionsProps): ReactElement | null => {
  if (props.converting) {
    return null;
  }

  return (
    <>
      {/* The transaction-TYPE selector does not live here: it renders as a
        select field directly under the Holding select, above the field group.
        This helper owns only the category picker and the "Convert to
        exchange" action — everything below the field group except while
        converting. */}

      {/* The category picker is ALWAYS editable on an income/expense row —
        even on a synced row — since a category edit propagates to every
        same-name transaction and to future imports (decision 3), unlike
        the bank-owned amount/sign. Exchange has no category: both legs'
        descriptions are fixed, auto-generated copy. */}
      {!props.isExchange && (
        <View ref={props.categoryFieldRef}>
          <Box gap={1}>
            <CategoryField
              label={props.t('forms.transaction.category')}
              testID="transaction-category-field"
              options={props.categoryOptions}
              selectedKey={props.selectedCategory}
              onSelect={props.onSelectCategory}
              // A category is required only on a fresh add (`plainFieldErrors`
              // gates a create on it); an edit leaves the category optional.
              required={!props.isEditing}
            />

            {props.categoryError !== undefined && <FieldError message={props.categoryError} />}
          </Box>
        </View>
      )}

      {/* Shown for BOTH a manual and a synced row — the action never mutates
        the existing row, so a read-only synced row stays safe to convert.
        Not gated by `!isReadOnly` for that reason. */}
      {props.convertEligible && (
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          icon="arrow.left.arrow.right"
          onPress={props.onPressConvert}
        >
          {props.t('forms.transaction.convertToExchange')}
        </Button>
      )}
    </>
  );
};

// Resolve the pending override's category into the icon name and the confirm
// copy the "Apply Category to All" sheet shows. The sheet renders the glyph
// white (textPrimary), not its category color, so only the icon name is needed
// here. Kept module-level so its null branch stays out of the screen
// component's cognitive-complexity budget.
type PendingCategoryView = { icon: string; message: string };

// `buildMessage` resolves the catalog's interpolated confirm copy; passed in
// (rather than read from a module-level template) so this helper stays
// translation-agnostic.
const resolvePendingCategory = (
  pendingOverride: { name: string; category: string } | null,
  categoryByKey: Parameters<typeof resolveCategoryDisplay>[1],
  buildMessage: (category: string, name: string) => string,
): PendingCategoryView | null => {
  if (pendingOverride === null) {
    return null;
  }

  // `pendingOverride.category` is always a user-PICKED, valid category key, so
  // the default-category fallback is never consulted here — the shared constant
  // is passed only to satisfy the resolver's signature (no settings read needed).
  const display = resolveCategoryDisplay(
    pendingOverride.category,
    categoryByKey,
    DEFAULT_CATEGORY_KEY,
  );

  return {
    icon: display.icon,
    message: buildMessage(display.title, pendingOverride.name.trim()),
  };
};

const TransactionFormScreen: FC<TransactionFormScreenProps> = ({ route, navigation }) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  // The mode row's display labels, resolved from the catalog inside the
  // component (rather than a module-level constant) so they always reflect
  // the active language.
  const modeLabels: Record<FormMode, string> = {
    income: t('forms.transaction.income'),
    expense: t('forms.transaction.expense'),
    exchange: t('forms.transaction.exchange'),
    split: t('forms.transaction.split'),
  };
  // The header's three candidate titles, and the synced-row notice — resolved
  // once per render and handed to the module-level helpers above so they stay
  // translation-agnostic.
  const titleLabels = {
    readOnly: t('forms.transaction.title'),
    editing: t('forms.transaction.editTitle'),
    adding: t('forms.transaction.addTitle'),
  };
  const syncedNotice = t('forms.transaction.syncedNotice');
  const buildApplyCategoryMessage = (category: string, name: string): string =>
    t('forms.transaction.applyCategoryMessage', { category, name });
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major amount to minor units) comes from
  // filtering the full holdings list — the same approach the detail screen uses.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  // The Exchange destination picker's account-name caption (Requirement C):
  // every account, reduced to an id -> name map so `buildExchangeOptions` can
  // thread a plain string onto each holding option without a per-row lookup
  // query.
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
  // The full account rows keyed by id, so the return picker can ask
  // `isSyncedHolding` whether a candidate's account is connected to a sync
  // (item 6) — the name/order maps above drop the `institution` that check needs.
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // The account display rank (F2): `accountsRepo.listQuery` is already ordered
  // by the drag-and-drop `sortOrder`, so each account's index IS its rank on
  // the Accounts screen. The picker groups its holdings under their account in
  // this same order (see `compareByAccountThenHolding`).
  const accountOrderById = new Map(accounts.map((account, index) => [account.id, index]));

  // Three entry points: `holdingId` = add a new manual row; `transactionId` =
  // open an existing one (edit/read-only); `duplicateOfTransactionId` = open the
  // CREATE form pre-filled FROM an existing manual row. Read once by a pure
  // helper so the component body spends no `in`-check branch on any of them. In
  // add mode the by-id query runs against an empty id and returns nothing,
  // keeping the hook order stable without a conditional call.
  const { editingId, duplicateOfId, holdingParamId, isEmptyCreate } = readRouteEntry(route.params);
  // ONE by-id subscription serves both the edit source and the duplicate source
  // (never both at once — the union keeps the params mutually exclusive).
  const { data: matchedTransactions } = useLiveQuery(
    transactionsRepo.getByIdQuery(editingId ?? duplicateOfId ?? ''),
    ['transactions'],
  );
  // `existing` stays the EDIT concept only, so `isEditing`/`isReadOnly`/convert
  // all behave unchanged; a duplicate is a CREATE, so its source is read into a
  // SEPARATE `duplicateSource` that seeds the fields on mount but never marks
  // the form as editing the source row.
  const existing = editingId ? matchedTransactions.at(0) : undefined;
  const duplicateSource = duplicateOfId ? matchedTransactions.at(0) : undefined;

  // The category picker's options come from the categories live query (a rename
  // flows straight through), and the confirm copy resolves the picked key to its
  // display title through the same map every screen uses.
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const categoryByKey = buildCategoryDisplayMap(categories);
  // The name→category rules (A1): subscribed once and reduced to a normalized-
  // name lookup map, so a create can pre-select a category from the settled
  // description on blur. Matching is JS-normalized (never SQL), mirroring the
  // sync insert path — see `ruleCategoryFor` and the description blur handler.
  const { data: overrideRules } = useLiveQuery(categoryOverridesRepo.allQuery(), [
    'category_overrides',
  ]);
  const categoryByNormalizedName = useMemo(
    () => new Map(overrideRules.map((rule) => [rule.normalizedName, rule.category])),
    [overrideRules],
  );
  // The distinct past MANUAL descriptions (newest-first), reduced to a plain
  // string list the inline suggestion row matches against as the user types.
  // Reactive on `'transactions'`, so a freshly saved manual row feeds the next
  // create's suggestions.
  const { data: pastDescriptionRows } = useLiveQuery(transactionsRepo.distinctDescriptionsQuery(), [
    'transactions',
  ]);
  // Create-only: an edit already has its description, so the pool is
  // emptied on an edit and the suggestion row hides itself. Gating here (in this
  // memo's own scope) rather than with a ternary at the render site keeps the
  // screen component's cognitive-complexity budget intact.
  const pastDescriptions = useMemo(
    () => (editingId != null ? [] : pastDescriptionRows.map((row) => row.description)),
    [editingId, pastDescriptionRows],
  );
  const categoryOptions = categories.map((category) => ({
    key: category.key,
    title: categoryByKey.get(category.key)?.title ?? category.title,
    icon: category.icon,
    color: resolveCategoryColor(category.color, category.key),
  }));

  // Feature 1 (convert prefill): the latest cached FX rates, parsed into a
  // numeric table so a picked convert counterpart's amount can be seeded from
  // the withdrawal magnitude. A missing pair seeds null, leaving the field blank.
  const { data: rateRows } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const rateTable = buildRateTable(rateRows);

  // The primary-holding seam: the SINGLE holding-from-state variable both the
  // duplicate path and the empty-create picker drive. The duplicate path seeds
  // it from the source row on mount; the empty-create picker seeds it from the
  // most-recent-manual default and
  // then lets the user re-point it through the picker below. Every
  // holding-derived value (currency, amount suffix, category eligibility,
  // exchange rules) reads through it. Null on a plain add/edit, where
  // `holdingParamId`/`existing` supply the holding instead.
  const [primaryHoldingId, setPrimaryHoldingId] = useState<string | null>(null);
  const holdingId = existing?.holdingId ?? primaryHoldingId ?? holdingParamId ?? undefined;
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  // Each money field's trailing currency glyph, keyed off the holding that owns
  // that leg. Empty when the owning holding hasn't resolved/been picked yet, so
  // a not-yet-known currency shows no symbol rather than a wrong one. The source
  // leg (plain amount, Exchange Value Out, and the convert fixed leg) all read
  // the current holding's currency.
  const amountSuffix = holding ? currencySymbol[holding.currency] : '';

  // The picker's eligible options (open, non-synced, transaction-eligible),
  // Accounts-ordered — also the fallback source when the user has no manual
  // history to default from.
  const primaryOptions = buildPrimaryOptions(
    holdings,
    accountNameById,
    accountOrderById,
    accountById,
  );
  // B's default-holding seam: the holding of the newest MANUAL row, read once so
  // an empty create can pre-select it. `isLoading` gates the seed below so the
  // "most recent, else first eligible" decision waits for this to settle rather
  // than racing the fallback in before the recent holding is known.
  const { data: latestManualRows, isLoading: latestManualLoading } = useLiveQuery(
    transactionsRepo.latestManualHoldingQuery(),
    ['transactions'],
  );
  const latestManualHoldingId = latestManualRows.at(0)?.holdingId ?? null;
  // The one-shot default holding id to seat the seam with on the empty-create
  // path (null otherwise, or once seeded/picked) — resolved by a pure helper so
  // the branch chain stays out of this component's cognitive-complexity budget.
  // The hydrate effect below feeds it to `resolveHydration`, which seeds it
  // through the SAME `seedHolding` step the duplicate path uses.
  const defaultPrimaryHoldingId = resolveDefaultPrimaryHolding({
    isEmptyCreate,
    primaryHoldingId,
    latestManualLoading,
    latestManualHoldingId,
    options: primaryOptions,
  });

  // A synced row of ANY source (monobank, binance, btc_wallet) is bank-owned:
  // its amount, description and time are set by the import and edits to them
  // silently no-op in `transactionsRepo.update`, so those fields render
  // read-only — not monobank alone. The CATEGORY stays editable and is
  // persisted through the single-row `setCategory` in `save` (a synced row's
  // description is often blank, so no propagation sheet opens for it).
  const isReadOnly = existing !== undefined && existing.source !== 'manual';
  // `editingId` is known synchronously from the route params, so the header
  // reads "Edit Transaction" immediately instead of flashing "Add Transaction"
  // until the row loads. Read-only still keys off the loaded `source`.
  const isEditing = editingId != null;

  const modeOptions = resolveModeOptions(isEditing, holding);
  const destinationOptions = buildExchangeOptions(
    holdings,
    accountNameById,
    accountOrderById,
    holdingId,
    isExchangeCreateDestinationType,
  );

  const convertView = resolveConvertView(
    existing,
    isEditing,
    holding,
    currency,
    holdings,
    accountNameById,
    accountOrderById,
    holdingId,
    t,
  );

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<FormMode>('expense');
  const isExchange = mode === 'exchange';
  const isSplit = mode === 'split';
  // The scroll-mode ScrollView's ref, so adding a split return can bring the
  // newly appended row into view. `useScrollOffset` reads its LIVE content
  // offset for `save`'s own `scrollToField` call below.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const headerInset = useHeaderInset();
  // The ScrollView's own total content height, captured off `Screen`'s
  // `onContentSizeChange` (forwarded from its ScrollView) so `scrollToField`
  // can bound an over-large target against the real content extent — see
  // scroll-to-field.ts's own overshoot-clamp doc. A plain ref, not state:
  // read only imperatively at Save-press time, never needs to re-render.
  const contentHeightRef = useRef(0);
  // Per-field wrapper refs, one per validated field, passed to `scrollToField`
  // in `save`'s blocked path below — each field's own inline error (a
  // `TextField`/`ExchangeFields`/`ConvertExchangeFields` `error` prop, or a
  // relocated `FieldError` for the category/split-returns reasons) sits right
  // beside it, so the scroll always lands on the same field the message is
  // anchored to.
  const counterpartHoldingFieldRef = useRef<FieldInstance>(null);
  const counterpartAmountFieldRef = useRef<FieldInstance>(null);
  const destinationFieldRef = useRef<FieldInstance>(null);
  const valueOutFieldRef = useRef<FieldInstance>(null);
  const valueInFieldRef = useRef<FieldInstance>(null);
  const categoryFieldRef = useRef<FieldInstance>(null);
  const splitReturnsFieldRef = useRef<FieldInstance>(null);
  // The LAST return row's own wrapper — a SEPARATE ref from
  // `splitReturnsFieldRef` above (which anchors the whole section for
  // scroll-to-invalid) — so `addReturn` below can scroll to whichever row is
  // newest, via the SAME occlusion-aware `scrollToField` helper (round-6
  // device feedback item 3), rather than an unconditional `scrollToEnd`.
  const lastReturnFieldRef = useRef<FieldInstance>(null);
  const amountFieldRef = useRef<FieldInstance>(null);
  // The plain Amount field's own inner input, for a blocked Save's FOCUS
  // follow-up once it has scrolled into view — the ONLY validated field
  // owned directly by this screen (every other field above is a picker with
  // no keyboard, or is owned by ExchangeFields/ConvertExchangeFields, which
  // have no matching focus ref of their own yet).
  const amountInputRef = useRef<TextInputInstance>(null);
  const focusByKey: Partial<Record<SaveDisabledField, () => void>> = {
    amount: () => amountInputRef.current?.focus(),
  };
  const fieldRefsByKey: Record<SaveDisabledField, RefObject<FieldInstance | null>> = {
    counterpartHolding: counterpartHoldingFieldRef,
    counterpartAmount: counterpartAmountFieldRef,
    destinationHolding: destinationFieldRef,
    valueOut: valueOutFieldRef,
    valueIn: valueInFieldRef,
    selectedCategory: categoryFieldRef,
    splitReturns: splitReturnsFieldRef,
    amount: amountFieldRef,
  };
  // The split payment's change-returns, one row per holding the change is
  // handed back to. Starts with a single empty row so the section always shows
  // one picker when Split is entered. `nextReturnId` hands out a stable key per
  // appended row (the same pattern as the term-deposit contribution rows), so a
  // removed row never reshuffles React keys onto the wrong inputs.
  const nextReturnId = useRef(1);
  const [changeReturns, setChangeReturns] = useState<ChangeReturnRow[]>([
    { id: 0, holdingId: null, amount: '' },
  ]);
  const [valueIn, setValueIn] = useState('');
  const [destinationHoldingId, setDestinationHoldingId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [counterpartHoldingId, setCounterpartHoldingId] = useState<string | null>(null);
  const [counterpartAmount, setCounterpartAmount] = useState('');
  // The transaction's time, defaulting to now for a fresh add so a manual row
  // can be BACKDATED via the DateField below. Edit mode hydrates the existing
  // time; picking a day sets it to that day's local midnight.
  const [time, setTime] = useState<number>(() => Date.now());
  // The picked category key (a categories.key slug, lowercase). Null = no
  // category yet. Editing it ALWAYS propagates to every same-name transaction
  // via the override rule — there is no single-row-only category edit.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Whether the user has explicitly picked a category through the picker. Gates
  // the description-blur auto-pick (A1): once the user chooses, a later matching
  // blur must never overwrite that choice.
  const [userPickedCategory, setUserPickedCategory] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Whether the user has pressed Save at least once. Save is always enabled;
  // this latches the inline reason on so it only ever appears after a press
  // that `disableSave` blocked, never live while the user is still filling
  // the form in.
  const [attemptedSave, setAttemptedSave] = useState(false);
  // The pending category-override confirmation. Non-null while the themed
  // confirm modal is up (carrying the affected name + picked category key);
  // null when no confirmation is in flight.
  const [pendingOverride, setPendingOverride] = useState<{
    name: string;
    category: string;
  } | null>(null);
  // Seed the fields once, when the source row (edit OR duplicate) and its
  // holding have loaded (the holding's currency scale is needed to render the
  // amount). The `hydrated` latch keeps a later live-query refresh from
  // clobbering in-progress edits. The edit-vs-duplicate decision lives in the
  // pure `resolveHydration` helper, so this effect stays a thin dispatch — a
  // duplicate first seats the `primaryHoldingId` seam (`seedHolding`), then, on
  // the next render once its holding resolves, seeds the copied fields
  // (`seedFields`) dated to NOW. Edit never reaches Exchange (`canExchange` is
  // `false` whenever `isEditing` is `true`), so hydrating straight to the
  // income/expense sign is safe for both paths.
  useEffect(() => {
    if (hydrated) {
      return;
    }

    const plan = resolveHydration({
      existing,
      duplicateSource,
      holding,
      primaryHoldingId,
      currency,
      defaultPrimaryHoldingId,
    });

    match(plan)
      .with({ kind: 'seedHolding' }, (seedHoldingPlan) => {
        setPrimaryHoldingId(seedHoldingPlan.holdingId);
        // Close the latch only for a FINAL seed (empty-create): `false` is a
        // no-op on the duplicate step (the latch is already open), so this stays
        // a single flat statement rather than another branch.
        setHydrated(seedHoldingPlan.final);
      })
      .with({ kind: 'seedFields' }, (seedFieldsPlan) => {
        setAmount(seedFieldsPlan.amount);
        setMode(seedFieldsPlan.sign);
        setDescription(seedFieldsPlan.description);
        setSelectedCategory(seedFieldsPlan.category);
        // A seeded non-null category counts as a user pick, so a later
        // description blur (A1's `reseatCategoryFromName`) can never clobber it.
        // This matters for the DUPLICATE path (`isEditing` is false there): the
        // "duplicate a row, tweak the note" flow must keep the copied category
        // when the retyped description matches no name rule. The edit path already
        // guards its stored category via `isEditing`, so this is a harmless no-op
        // there; the empty-create/fixed-holding paths seed a null category, so
        // `userPickedCategory` stays false and A1's normal create-blur auto-seat
        // is unaffected.
        if (seedFieldsPlan.category !== null) {
          setUserPickedCategory(true);
        }

        // A null `time` keeps the field at NOW — the duplicate never copies the
        // source timestamp; the edit path carries the stored time.
        if (seedFieldsPlan.time !== null) {
          setTime(seedFieldsPlan.time);
        }

        setHydrated(true);
      })
      // Neither the source row's holding nor a default primary holding has
      // resolved yet — nothing to seed this render; the effect re-runs once one
      // of its dependencies (e.g. `holding`) resolves.
      .with({ kind: 'wait' }, () => {})
      .exhaustive();
  }, [
    existing,
    duplicateSource,
    holding,
    primaryHoldingId,
    hydrated,
    currency,
    defaultPrimaryHoldingId,
  ]);

  // Feature 1: seed the counterpart (cash) amount from the latest cached rate at
  // the MOMENT a destination is picked — an EVENT, not a derivation, so it lives
  // in the pick handler rather than an effect (no re-seed-every-render clobber,
  // no exhaustive-deps override). Only on an expense-sourced convert (a card->cash
  // withdrawal): same currency -> 1:1; a missing rate
  // (`seedCounterpartMinorUnits` returns null) leaves the field AS IS, so a later
  // manual edit is preserved and a blank stays blank. Reads the just-picked `id`
  // (not the still-stale `counterpartHoldingId` state). The synced bank row is
  // never touched — this only fills a form field.
  const selectCounterpart = (id: string): void => {
    setCounterpartHoldingId(id);

    if (!convertView.eligible || convertView.direction !== 'record-destination' || !existing) {
      return;
    }

    const counterpart = holdings.find((candidate) => candidate.id === id);

    if (counterpart === undefined) {
      return;
    }

    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: existing.amountMinorUnits,
      sourceCurrency: currency,
      counterpartCurrency: counterpart.currency,
      rateTable,
    });

    if (seeded === null) {
      return;
    }

    setCounterpartAmount(groupAmount(majorAmountText(counterpart.currency, seeded)));
  };

  // The row's category at open, keyed the same way, so an edit is detectable.
  // Derived (not stored) so it always reflects the persisted value even before
  // the hydration latch closes.
  const originalCategoryKey = existing?.category ? existing.category.toLowerCase() : null;
  const categoryChanged = selectedCategory !== null && selectedCategory !== originalCategoryKey;

  // The description field's placeholder previews the label the row would carry
  // if left blank (see `resolveDescriptionPlaceholder`), and the Save button is
  // disabled for a create still missing its amount or category (see
  // `transactionFieldErrors`). Both are module-level pure helpers so their
  // branches stay out of this component's cognitive-complexity budget.
  const descriptionPlaceholder = resolveDescriptionPlaceholder(holding, mode, t);
  const saveDisabledParams: SaveDisabledParams = {
    converting,
    isExchange,
    isSplit,
    isReadOnly,
    isEditing,
    amount,
    valueIn,
    counterpartAmount,
    destinationHoldingId,
    counterpartHoldingId,
    selectedCategory,
    changeReturns,
    currency,
  };
  // Every field's OWN independent error (see `transactionFieldErrors`'s own
  // doc comment) — `fieldError` just applies the shared `attemptedSave` gate
  // once here instead of at each of the eight call sites below.
  const activeFieldErrors = transactionFieldErrors(saveDisabledParams, t);
  const fieldError = (key: SaveDisabledField): string | undefined =>
    attemptedSave ? activeFieldErrors[key] : undefined;
  // The first still-blocking field, in the active mode's own priority order
  // — both the Save-block gate AND the scroll-to-first-invalid target, so
  // the two can never disagree about which field is blocking.
  const disableSaveField = firstInvalidField(
    activeFieldOrder(saveDisabledParams),
    activeFieldErrors,
  );
  const disableSave = disableSaveField !== null;

  // An explicit category pick: record the choice AND flag it, so a later
  // description blur (the A1 auto-pick) never overwrites what the user chose.
  const selectCategory = (key: string): void => {
    setSelectedCategory(key);
    setUserPickedCategory(true);
  };

  // A1's category auto-pick, factored into ONE surface both the description
  // blur AND the suggestion tap route through, so the two never stack a
  // second independent description effect. Given a settled name and no explicit
  // user pick, pre-select the category the existing name rules map that name to;
  // a name matching no rule yields null, which clears any prior auto-pick so
  // Save's create-time category requirement re-engages honestly. Only fires on a
  // create — an edit hydrates its own stored category and must not be re-derived
  // from the name. Takes the name explicitly (not the `description` state) so the
  // suggestion tap can seat from the just-picked value before its `setDescription`
  // has flushed.
  const reseatCategoryFromName = (name: string): void => {
    if (userPickedCategory || isEditing) {
      return;
    }

    setSelectedCategory(ruleCategoryFor(name, categoryByNormalizedName));
  };

  // A1: when the description SETTLES (blur, never a keystroke), re-seat the
  // category from the current field value through the shared surface above.
  const onDescriptionBlur = (): void => {
    reseatCategoryFromName(description);
  };

  // Tapping an inline suggestion fills the description verbatim AND re-fires
  // A1's rule lookup on that same value, so picking a known merchant name seats
  // its category exactly as a blur would — ONE coherent description-handling
  // surface, not two competing effects.
  const pickSuggestion = (suggestion: string): void => {
    setDescription(suggestion);
    reseatCategoryFromName(suggestion);
  };

  const title = headerTitle(isReadOnly, isEditing, titleLabels);
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  // Persist the amount/description edit on a manual row (edit vs. add). Only
  // ever called from the income/expense path (`save` branches Exchange off to
  // `saveExchange` before reaching here), so `mode` is guaranteed a `Sign`.
  const writeManual = async (): Promise<void> => {
    const amountMinorUnits = signedMinorUnits(currency, amount, mode as Sign);

    if (editingId) {
      // Leave the category to the always-propagating override path below:
      // `transactionsRepo.update` deliberately handles only amount/time/
      // description with its own balance-delta logic, and an edit's category
      // change still routes through the override rule.
      await transactionsRepo.update({
        transactionId: editingId,
        amountMinorUnits,
        time,
        description,
      });

      return;
    }

    if (holdingId) {
      await transactionsRepo.recordManual({
        holdingId,
        amountMinorUnits,
        time,
        description,
        // The row carries its OWN category. The override sheet below governs
        // only whether the pick ALSO propagates to every same-name row; it is
        // not what categorises this row. Previously the pick was persisted
        // only through the override rule, which returns early on a blank
        // normalized name — so a blank-description row (and any row whose
        // override the user cancelled) was written uncategorised despite
        // `plainFieldErrors` forcing a pick on create.
        category: selectedCategory,
      });
    }
  };

  // The shared failure alert for every write this screen makes: `save`,
  // `applyOverride`, and `applyOverrideOne` each catch their own write and
  // call this rather than repeating the same two catalog keys three times.
  const showSaveErrorAlert = (): void => {
    alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
  };

  // Editing a category ALWAYS propagates to every same-name transaction (and to
  // future imports), so surface the blast radius in a themed confirm modal
  // before writing the rule. Both paths return to the list (the manual edit, if
  // any, has already been written); only "Apply" also writes the override rule.
  const applyOverride = async (): Promise<void> => {
    if (pendingOverride === null) {
      return;
    }

    try {
      await categoryOverridesRepo.upsertCategoryOverride(
        pendingOverride.name,
        pendingOverride.category,
      );
      navigation.goBack();
    } catch {
      showSaveErrorAlert();
    }
  };

  // A second `useSubmitOnce` instance, not the Save button's: this guards the
  // sheet's "Apply" write, an independent action reachable only once `save()`
  // has already returned (its own guard is idle again by then) and the sheet
  // is showing. Sharing one instance would conflate two different actions'
  // in-flight state under a single boolean — either action could wrongly
  // block the other — for no benefit, since neither button is ever pressed
  // while the other's write is in flight.
  const { onPress: onApplyOverride, isSubmitting: isApplyingOverride } =
    useSubmitOnce(applyOverride);

  // The "just for this one" path: persist the picked category on THIS row ONLY,
  // by id, then return to the list. Unlike `applyOverride` (the all-similar name
  // rule), nothing propagates to other same-name rows or to future imports —
  // `transactionsRepo.setCategory` rewrites the single target row's category and
  // nothing else. Only reachable in EDIT mode: `editingId` targets an existing
  // row, so the branch is guarded on it and the button is offered only when it
  // is present. A brand-new unsaved row has no id to target — and already
  // carries its category from `recordManual` — so this action is not offered
  // there.
  const applyOverrideOne = async (): Promise<void> => {
    if (pendingOverride === null || editingId === null) {
      return;
    }

    try {
      await transactionsRepo.setCategory({
        transactionId: editingId,
        category: pendingOverride.category,
      });
      navigation.goBack();
    } catch {
      showSaveErrorAlert();
    }
  };

  // A third independent `useSubmitOnce` instance, for the same reason
  // `onApplyOverride` has its own (see above): each sheet action's in-flight
  // state must stay separate so one never wrongly blocks another.
  const { onPress: onApplyOverrideOne, isSubmitting: isApplyingOverrideOne } =
    useSubmitOnce(applyOverrideOne);

  const cancelOverride = (): void => {
    navigation.goBack();
  };

  // The picked category's resolved icon name + confirm copy for the sheet. The
  // sheet renders the glyph white (textPrimary), not its category color, by
  // design. Bundled by a module-level helper so the JSX gates on a single
  // nullable and the branch stays out of the component body.
  const pendingCategory = resolvePendingCategory(
    pendingOverride,
    categoryByKey,
    buildApplyCategoryMessage,
  );
  const overrideMessage = pendingCategory?.message ?? '';

  // Append an empty return row; `nextReturnId` keeps its React key stable.
  const addReturn = (): void => {
    const id = nextReturnId.current++;

    setChangeReturns((rows) => [...rows, { id, holdingId: null, amount: '' }]);

    // The new row's fields are only measured after this render commits, so
    // defer the scroll to the next frame — otherwise `lastReturnFieldRef`
    // would still measure the PRE-add (one row shorter) layout. Same
    // deferred-RAF pattern as the categories screen's own
    // `scrollToAddCategoryForm`. Routes through the SAME occlusion-aware
    // `scrollToField` helper `save`'s own scroll-to-invalid uses below
    // (round-6 device feedback item 3) — an unconditional `scrollToEnd` used
    // to fire even when the new row was already fully on screen.
    requestAnimationFrame(() => {
      scrollToField(scrollableRef, lastReturnFieldRef, {
        currentOffset: scrollOffset.value,
        headerInset,
        contentHeight: contentHeightRef.current,
      });
    });
  };

  const removeReturn = (index: number): void => {
    setChangeReturns((rows) => rows.filter((_, i) => i !== index));
  };

  const selectReturnHolding = (index: number, holdingId: string): void => {
    setChangeReturns((rows) => rows.map((row, i) => (i === index ? { ...row, holdingId } : row)));
  };

  const changeReturnAmount = (index: number, next: string): void => {
    setChangeReturns((rows) =>
      rows.map((row, i) => (i === index ? { ...row, amount: groupAmount(next) } : row)),
    );
  };

  // The return-row picker's options for a given row: every eligible payer-
  // currency holding (the payer itself included — item 2), minus every holding
  // already picked in ANOTHER row, so two rows can never target the same holding
  // through the UI, and minus any synced/syncable holding (item 6).
  const returnOptionsFor = (index: number): HoldingSelectOption[] => {
    const pickedElsewhere = new Set(
      changeReturns
        .filter((row, i) => i !== index && row.holdingId !== null)
        .map((row) => row.holdingId as string),
    );

    return buildReturnOptions(
      holdings,
      accountNameById,
      accountOrderById,
      accountById,
      currency,
      pickedElsewhere,
    );
  };

  // The split save path: one negative payment carrying its category on the payer,
  // plus N positive returns on distinct other holdings, written as N+1 linked
  // rows in one transaction via `recordManualWithReturns`. `canSaveSplit` is the
  // guard (the repo has none), so the `as string` casts below are proven safe.
  const saveSplit = async (): Promise<void> => {
    if (holding === undefined || !canSaveSplit(amount, changeReturns, holding.currency)) {
      return;
    }

    const paymentMinor = Money.fromMajor(holding.currency, parseAmount(amount)).minorUnits;

    await transactionsRepo.recordManualWithReturns({
      payment: {
        holdingId: holding.id,
        amountMinorUnits: -paymentMinor,
        time,
        description,
        category: selectedCategory,
      },
      returns: changeReturns.map((change) => ({
        holdingId: change.holdingId as string,
        amountMinorUnits: Money.fromMajor(holding.currency, parseAmount(change.amount)).minorUnits,
      })),
    });

    navigation.goBack();
  };

  // The Exchange save path: two independent legs (an outgoing amount from
  // `holding`, an incoming amount into `destination`), routed through
  // `recordExchange` in one op-sqlite transaction. Extracted out of `save` so
  // the component body's cognitive-complexity budget stays under the cap.
  const saveExchange = async (): Promise<void> => {
    const destination = holdings.find((candidate) => candidate.id === destinationHoldingId);

    if (holding === undefined || destination === undefined) {
      return;
    }

    const valueOutMajor = parseAmount(amount);
    const valueInMajor = parseAmount(valueIn);

    if (Number.isNaN(valueOutMajor) || valueOutMajor <= 0) {
      return;
    }

    if (Number.isNaN(valueInMajor) || valueInMajor <= 0) {
      return;
    }

    const valueOut = Money.fromMajor(holding.currency, valueOutMajor);
    const valueInMoney = Money.fromMajor(destination.currency, valueInMajor);

    await transactionsRepo.recordExchange({
      sourceHoldingId: holding.id,
      valueOutMinorUnits: valueOut.minorUnits,
      destinationHoldingId: destination.id,
      destinationType: destination.type,
      valueInMinorUnits: valueInMoney.minorUnits,
      time,
    });

    navigation.goBack();
  };

  // The convert save path: writes ONLY the missing counterpart leg via
  // `recordExchangeCounterpart`, never touching the existing row. Extracted
  // out of `save` for the same cognitive-complexity-budget reason as
  // `saveExchange` above.
  const saveConvert = async (): Promise<void> => {
    const counterpart = holdings.find((candidate) => candidate.id === counterpartHoldingId);

    // `holding` (the EXISTING row's own holding) is required, not optional:
    // its id becomes the new leg's exchange marker, and a marker pointing at
    // nothing would leave the leg unlabelable at render time.
    if (
      existing === undefined ||
      counterpart === undefined ||
      holding === undefined ||
      convertView.direction === null
    ) {
      return;
    }

    const amountMajor = parseAmount(counterpartAmount);

    if (Number.isNaN(amountMajor) || amountMajor <= 0) {
      return;
    }

    const counterpartMoney = Money.fromMajor(counterpart.currency, amountMajor);

    await transactionsRepo.recordExchangeCounterpart({
      direction: convertView.direction,
      counterpartHoldingId: counterpart.id,
      counterpartType: counterpart.type,
      amountMinorUnits: counterpartMoney.minorUnits,
      existingTransactionId: existing.id,
      existingHoldingId: holding.id,
      time,
    });

    navigation.goBack();
  };

  // Guard: reject an empty, non-numeric, or NON-POSITIVE amount, then write
  // the manual edit. Returns whether the write happened, so `save` can abort
  // the whole flow (including the category confirm below) on a bad amount
  // without its own nested branch.
  //
  // The magnitude test is the same `<= 0` rejection `saveExchange` and
  // `saveConvert` already apply. Testing only empty/NaN let `"0"` through and
  // created a 0.00 row, contradicting this guard's own "no zero-amount row"
  // claim. The user's income/expense chip carries the sign, so the typed
  // magnitude is always non-negative here — `<= 0` means "zero".
  const tryWriteManual = async (): Promise<boolean> => {
    const magnitude = parseAmount(amount);

    if (amount.trim() === '' || Number.isNaN(magnitude) || magnitude <= 0) {
      return false;
    }

    await writeManual();

    return true;
  };

  // The three non-manual save modes, dispatched ahead of the income/expense
  // path. Returns whether one of them handled the write, so `save` stays a
  // single early-return without carrying all three branches in its own
  // cognitive-complexity budget.
  const dispatchSpecialSave = async (): Promise<boolean> => {
    if (converting) {
      await saveConvert();

      return true;
    }

    if (isSplit) {
      await saveSplit();

      return true;
    }

    if (isExchange) {
      await saveExchange();

      return true;
    }

    return false;
  };

  // The outer Save gate: Save is always enabled, so a press while
  // `disableSave` is true latches `attemptedSave` (surfacing the inline
  // reason) and scrolls to the first invalid field instead of writing
  // anything. Kept as a thin wrapper around `performSave` — folding the gate
  // into `performSave` itself pushes that function's cognitive complexity
  // over Biome's ceiling.
  const save = async (): Promise<void> => {
    if (disableSave) {
      setAttemptedSave(true);

      if (disableSaveField) {
        scrollToField(
          scrollableRef,
          fieldRefsByKey[disableSaveField],
          {
            currentOffset: scrollOffset.value,
            headerInset,
            contentHeight: contentHeightRef.current,
          },
          focusByKey[disableSaveField],
        );
      }

      return;
    }

    await performSave();
  };

  const performSave = async (): Promise<void> => {
    try {
      if (await dispatchSpecialSave()) {
        return;
      }

      // A synced row is bank-owned: only its category may change, so skip the
      // amount write entirely and fall through to the category confirm below.
      if (!isReadOnly && !(await tryWriteManual())) {
        return;
      }

      // The rule keys on the synced row's own description (read-only) or the
      // just-saved manual description.
      const name = isReadOnly ? (existing?.description ?? '') : description;
      const overrideRequest = resolveCategoryOverrideRequest(
        categoryChanged,
        selectedCategory,
        name,
      );

      if (overrideRequest) {
        setPendingOverride(overrideRequest);

        return;
      }

      // No propagation sheet will open — the normalized name is blank (a synced
      // Binance/wallet row imports with an empty description), or the row is
      // synced so `writeManual`'s `update` refused to persist its category. Write
      // the picked category straight onto THIS row by id via the ungated
      // `setCategory`, so a category change on an existing row is never dropped.
      // This is the single-row writer only; the blank-name guard on the name RULE
      // path (`resolveCategoryOverrideRequest` -> `upsertCategoryOverride`) stays
      // intact, so a catch-all rule is still refused. A create (no `editingId`)
      // already carries its category from `recordManual`, so it is excluded.
      if (editingId !== null && categoryChanged && selectedCategory !== null) {
        await transactionsRepo.setCategory({
          transactionId: editingId,
          category: selectedCategory,
        });
      }

      navigation.goBack();
    } catch {
      // Every write above — recordManual/recordManualWithReturns/recordExchange/
      // recordExchangeCounterpart/update/setCategory — used to escape unhandled:
      // the screen just silently failed to navigate, with Save re-enabled and
      // no explanation. Mirror the established Alert pattern instead.
      showSaveErrorAlert();
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  // The transaction-TYPE selector, built here so the label/mode copy stays with
  // the component's live translations. It renders directly UNDER the Holding
  // select field (not while converting, which has no mode toggle). Uses the
  // transaction-scoped `forms.transaction.type` ("Type") label, decoupled from
  // the holding form's own `forms.holding.type`. On a read-only (synced) row the
  // field is `disabled`: the trigger is inert and dims like every other locked
  // field, so a synced transaction's bank-owned sign cannot be toggled here.
  const typeSelectField = (
    <ModeSelectField
      visible={!converting}
      label={t('forms.transaction.type')}
      options={modeOptions}
      selected={mode}
      onSelect={setMode}
      labels={modeLabels}
      icons={MODE_ICONS}
      disabled={isReadOnly}
    />
  );

  return (
    <>
      <Screen
        scroll
        scrollableRef={scrollableRef}
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height;
        }}
        footer={
          showsSaveButton(isReadOnly, categoryChanged, converting) ? (
            <Button onPress={onSave} disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          ) : undefined
        }
      >
        <Box gap={4} testID="transaction-form">
          {renderReadOnlyNotice(isReadOnly, theme.colors.surfaceHigh, syncedNotice)}

          {/* B: the primary-leg holding picker, shown ONLY when no holding was
            fixed by navigation (the global-add entry). It drives the shared
            `primaryHoldingId` seam, so the currency/category/exchange derivation
            below follows the pick automatically. Null on every other path. */}
          {renderPrimaryHoldingField({
            visible: isEmptyCreate,
            label: t('forms.transaction.holding'),
            placeholder: t('forms.transaction.selectHolding'),
            options: primaryOptions,
            selectedId: primaryHoldingId,
            onSelect: setPrimaryHoldingId,
          })}

          {/* The transaction-TYPE selector, directly under the Holding select.
            Built with `visible={!converting}` (a convert has no mode toggle),
            so it is rendered unconditionally here — the field itself carries
            both that gate and the read-only dimming for a synced row. */}
          {typeSelectField}

          {/* Convert-mode replaces the entire income/expense/exchange field
            group with the single-counterpart convert group — no mode toggle,
            no category, just the fixed existing leg plus the one leg being
            recorded. Exchange gets its own field group (Value Out, To, Value
            In, Date — see `src/screens/forms/exchange-fields`); income/expense
            keeps its ORIGINAL field order (Amount, Description, Date)
            literally inline here, unchanged from before Exchange existed.
            The three-way switch lives in the module-level `renderFieldGroup`
            (see above) rather than a nested ternary here. */}
          {renderFieldGroup({
            converting,
            convertView,
            counterpartHoldingId,
            onSelectCounterpart: selectCounterpart,
            counterpartAmount,
            onChangeCounterpartAmount: (text) => setCounterpartAmount(groupAmount(text)),
            isExchange,
            amount,
            onChangeAmount: (text) => setAmount(groupAmount(text)),
            amountSuffix,
            // The fixed convert leg is the existing transaction's own holding,
            // so it shares the source holding's currency glyph.
            fixedSuffix: amountSuffix,
            destinationOptions,
            destinationHoldingId,
            onSelectDestination: setDestinationHoldingId,
            valueIn,
            onChangeValueIn: (text) => setValueIn(groupAmount(text)),
            valueInSuffix: holdingSuffix(holdings, destinationHoldingId),
            counterpartSuffix: holdingSuffix(holdings, counterpartHoldingId),
            description,
            onChangeDescription: setDescription,
            onBlurDescription: onDescriptionBlur,
            // The inline suggestion row. Its pool is already empty on an
            // edit (see the `pastDescriptions` memo), and the component itself
            // hides when there is no match or the field already equals a
            // suggestion, so it is passed unconditionally here.
            descriptionSuggestions: (
              <DescriptionSuggestions
                descriptions={pastDescriptions}
                value={description}
                onPick={pickSuggestion}
              />
            ),
            descriptionPlaceholder,
            isReadOnly,
            time,
            onChangeTime: setTime,
            t,
            amountError: fieldError('amount'),
            amountFieldRef,
            amountInputRef,
            valueOutError: fieldError('valueOut'),
            destinationError: fieldError('destinationHolding'),
            valueInError: fieldError('valueIn'),
            valueOutFieldRef,
            destinationFieldRef,
            valueInFieldRef,
            counterpartError: fieldError('counterpartHolding'),
            counterpartAmountError: fieldError('counterpartAmount'),
            counterpartFieldRef: counterpartHoldingFieldRef,
            counterpartAmountFieldRef,
          })}

          {/* Split-change only: the dynamic return rows + "Add return" action,
            rendered below the reused Amount/Description/Date/Time group. The
            `visible` gate and the `.map` live in the module-level
            `renderSplitReturns`, so this stays a single call. Wrapped in
            `splitReturnsFieldRef` here (the CALL SITE) rather than inside the
            helper, so the ref anchors the whole section for scroll-to-invalid.
            `renderSplitReturns` renders `null` in every non-split mode, but
            this wrapper `View` still counts as a flex item in the parent
            `Box`'s `gap` layout — `styles.hidden` (`display: 'none'`) keeps a
            hidden wrapper out of that gap slot while the mode is not split,
            without unmounting it (so the ref stays usable the moment split
            mode is selected).
            Round-6 device feedback item 2 (a regression this wrapper itself
            introduced, back when it first replaced `renderSplitReturns`'s
            Fragment as a DIRECT child of the parent `Box gap={4}`): its
            divider/heading/rows/error/button used to be that Box's own direct
            children, each getting the 16pt rhythm between them; wrapped in one
            `View`, they became ONE child with nothing supplying a gap between
            them. `styles.splitReturnsGap` gives this wrapper the SAME gap
            itself, restoring the rhythm — it is harmless while hidden
            (`display: 'none'` still collapses the whole node). A plain `View`
            (not `Box`) is required here: `Box` is a non-forwarding function
            component, so `ref={splitReturnsFieldRef}` on it would never
            resolve for `measureLayout`. */}
          <View
            ref={splitReturnsFieldRef}
            style={[styles.splitReturnsGap, !isSplit && styles.hidden]}
            testID="split-returns-wrapper"
          >
            {renderSplitReturns({
              visible: isSplit,
              returns: changeReturns,
              buildOptions: returnOptionsFor,
              onSelectHolding: selectReturnHolding,
              onChangeAmount: changeReturnAmount,
              onRemove: removeReturn,
              onAdd: addReturn,
              suffix: amountSuffix,
              selectHoldingPlaceholder: t('forms.transaction.selectHolding'),
              t,
              error: fieldError('splitReturns'),
              lastRowRef: lastReturnFieldRef,
            })}
          </View>

          {/* The mode chip row, category picker, and "Convert to exchange"
            action — everything below the main field group EXCEPT while
            converting. The `!converting` gate and every `&&`-conditional
            live in the module-level `renderModeAndActions` (see above). */}
          {renderModeAndActions({
            converting,
            isReadOnly,
            isExchange,
            categoryOptions,
            selectedCategory,
            onSelectCategory: selectCategory,
            convertEligible: convertView.eligible,
            onPressConvert: () => setConverting(true),
            isEditing,
            t,
            categoryError: fieldError('selectedCategory'),
            categoryFieldRef,
          })}

          {/* After description AND category — the top of the form (above
              holding/type/amount) reads wrong for a supplementary,
              often-empty field. */}
          {renderCommentRow(existing?.comment, t('forms.transaction.comment'))}
        </Box>
      </Screen>

      {/* The category-override confirmation, as a themed sheet rather than a
          native Alert (which cannot be styled). "Apply" is the accent-filled
          primary all-similar name rule; "Just for this one" (edit mode only) is
          the secondary single-row override; "Cancel" is a transparent ghost with
          a red label. Dismissing the sheet (scrim/back) behaves like Cancel — it
          returns to the list. */}
      <BottomSheet
        visible={pendingOverride !== null}
        onDismiss={cancelOverride}
        gap={3}
        header={
          <Box direction="row" gap={2} style={styles.confirmHeader}>
            {pendingCategory !== null && (
              <SymbolIcon name={pendingCategory.icon} size={22} tone="textPrimary" />
            )}

            <Text variant="heading">{t('forms.transaction.applyCategoryToAll')}</Text>
          </Box>
        }
        testID="category-override-sheet"
      >
        <Text variant="body" tone="textSecondary">
          {overrideMessage}
        </Text>

        <Button onPress={onApplyOverride} disabled={isApplyingOverride}>
          {t('forms.transaction.apply')}
        </Button>

        {editingId !== null && (
          <Button variant="secondary" onPress={onApplyOverrideOne} disabled={isApplyingOverrideOne}>
            {t('forms.transaction.applyToThisOne')}
          </Button>
        )}

        <Button variant="ghost" textColor={theme.colors.negative} onPress={cancelOverride}>
          {t('common.cancel')}
        </Button>
      </BottomSheet>
    </>
  );
};

const styles = StyleSheet.create((theme) => ({
  notice: {
    borderRadius: theme.radii.sm,
  },
  // Vertically centers the category glyph against the sheet's heading, so the
  // colored icon reads on the same baseline as "Apply Category to All".
  confirmHeader: {
    alignItems: 'center',
  },
  // Keeps the split-returns wrapper out of the parent `Box`'s `gap` layout
  // while `renderSplitReturns` renders `null` (every non-split mode) — RN
  // excludes a `display: 'none'` view from flex/gap layout entirely, unlike
  // an empty rendered child, which still counts as a flex item and doubles
  // the gap on both sides of it. The node (and its ref) stay mounted, so
  // `splitReturnsFieldRef` is still usable the instant split mode is picked.
  hidden: {
    display: 'none',
  },
  // Round-6 device feedback item 2: the wrapper's own gap, matching the
  // parent form `Box`'s `gap={4}` rhythm — see the CALL SITE comment above
  // for why this wrapper (not `renderSplitReturns` itself) owns it.
  splitReturnsGap: {
    gap: theme.spacing(4),
  },
}));

export default TransactionFormScreen;
