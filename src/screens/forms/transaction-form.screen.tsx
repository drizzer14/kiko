import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { categoriesRepo } from '@kiko/categories/categories.repo';
import { categoryOverridesRepo } from '@kiko/categories/category-overrides.repo';
import { holdingsRepo } from '@kiko/holdings/holdings.repo';
import { transactionsRepo } from '@kiko/transactions/transactions.repo';
import type { TFunction } from 'i18next';
import { type FC, type ReactElement, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
} from '../../categories/category-display';
import { type Currency, currencySymbol } from '../../currency/currency';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import type { HoldingRow, TransactionRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import BottomSheet from '../../design-system/components/bottom-sheet';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import TextField from '../../design-system/components/text-field';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { holdingTypeSymbol } from '../../holdings/entity-symbols';
import {
  canConvertToExchange,
  type ExchangeConvertDirection,
  exchangeConvertDirection,
} from '../../holdings/exchange-convert';
import {
  isExchangeCreateDestinationType,
  isExchangeCreateSourceType,
  isExchangeDestinationType,
  isExchangeSourceType,
} from '../../holdings/exchange-destination';
import type { TransactionFormParams } from '../../navigation/types';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
import { defaultTransactionDescription } from '../../transactions/default-description';
import { normalizeTransactionName } from '../../transactions/normalize-name';

import { groupAmount, majorAmountText } from './amount-format';
import CategoryField from './category-field';
import ChipRow from './chip-row';
import ConvertExchangeFields from './convert-exchange-fields';
import DateField from './date-field';
import ExchangeFields from './exchange-fields';
import type { HoldingSelectOption } from './holding-select-field/holding-select-field.props';
import TimeField from './time-field';
import { useSubmitOnce } from './use-submit-once';

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

// The form's own mode is a superset of `Sign`: an Exchange is neither an
// income nor an expense row, so it gets its own branch through `save` (see
// `saveExchange` below) rather than trying to force it through the signed
// income/expense amount path.
type FormMode = 'income' | 'expense' | 'exchange';

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
// (a negative for expense, non-negative otherwise). Falls back to the generic
// "Description" word when no holding has resolved yet, so there is nothing to
// preview. Kept module-level and pure so its branch stays out of the screen
// component's cognitive-complexity budget; `t` is the full `TFunction` (both
// the fallback and the interpolated preview flow through it).
const resolveDescriptionPlaceholder = (
  holding: Pick<HoldingRow, 'name'> | undefined,
  mode: FormMode,
  t: TFunction,
): string =>
  holding !== undefined
    ? defaultTransactionDescription(holding.name, mode === 'expense' ? -1 : 0, t)
    : t('forms.transaction.description');

// Whether a money field holds a strictly positive number — the same guard every
// `save` path applies before it writes. `parseAmount` yields NaN for a blank,
// whitespace, or junk field, and `NaN > 0` is false, so one comparison covers
// every rejected case (the same idiom as `contribution-form`'s `canSave`).
const isPositiveAmountText = (text: string): boolean => parseAmount(text) > 0;

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
  isReadOnly: boolean;
  isEditing: boolean;
  amount: string;
  valueIn: string;
  counterpartAmount: string;
  destinationHoldingId: string | null;
  counterpartHoldingId: string | null;
  selectedCategory: string | null;
};

const isSaveDisabled = (params: SaveDisabledParams): boolean => {
  if (params.converting) {
    return params.counterpartHoldingId === null || !isPositiveAmountText(params.counterpartAmount);
  }

  if (params.isExchange) {
    return (
      params.destinationHoldingId === null ||
      !isPositiveAmountText(params.amount) ||
      !isPositiveAmountText(params.valueIn)
    );
  }

  if (params.isReadOnly) {
    return false;
  }

  if (params.isEditing) {
    return !isPositiveAmountText(params.amount);
  }

  return !isPositiveAmountText(params.amount) || params.selectedCategory === null;
};

// Whether `save` needs to raise the propagation-confirm sheet, and with what
// payload: only when the category actually changed AND the affected name is
// non-blank. `upsertCategoryOverride` refuses to write a rule for a blank
// normalized name (it must not become a catch-all), so confirming propagation
// for one asked `Apply "Groceries" to all transactions named ""?` and then
// wrote nothing — the row's own category is already persisted by `writeManual`
// regardless, so `save` just returns to the list instead. Kept module-level
// and pure for the same cognitive-complexity-budget reason as `isSaveDisabled`.
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

  return canExchange ? ['income', 'expense', 'exchange'] : ['income', 'expense'];
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
  descriptionPlaceholder: string;
  isReadOnly: boolean;
  time: number;
  onChangeTime: (timestamp: number) => void;
  t: TFunction;
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
      />
    );
  }

  return (
    <>
      <TextField
        label={props.t('forms.fields.amount')}
        value={props.amount}
        onChangeText={props.onChangeAmount}
        editable={!props.isReadOnly}
        keyboardType="decimal-pad"
        placeholder="0.00"
        suffix={props.amountSuffix}
        // A read-only (synced) row's amount never gates save, so it carries no
        // required marker; a manual add/edit always needs a positive amount.
        required={!props.isReadOnly}
      />

      <TextField
        label={props.t('forms.transaction.description')}
        value={props.description}
        onChangeText={props.onChangeDescription}
        editable={!props.isReadOnly}
        placeholder={props.descriptionPlaceholder}
      />

      <DateField
        label={props.t('forms.fields.date')}
        value={props.time}
        onChange={props.onChangeTime}
        disabled={props.isReadOnly}
      />

      <TimeField
        label={props.t('forms.fields.time')}
        value={props.time}
        onChange={props.onChangeTime}
        disabled={props.isReadOnly}
      />
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

// The mode chip row, category picker, "Convert to exchange" action, and
// Delete button: everything below the main field group EXCEPT while
// converting (a convert has no mode toggle, no category, and no delete —
// just the convert group and Save). Extracted to its own module-level
// function for the same cognitive-complexity-budget reason as
// `renderFieldGroup` above: several independent `&&`-gated conditions, kept
// out of the screen component's own branch count.
type ModeAndActionsProps = {
  converting: boolean;
  modeOptions: readonly FormMode[];
  mode: FormMode;
  onSelectMode: (mode: FormMode) => void;
  modeLabels: Record<FormMode, string>;
  isReadOnly: boolean;
  isExchange: boolean;
  categoryOptions: { key: string; title: string; icon: string; color: string }[];
  selectedCategory: string | null;
  onSelectCategory: (key: string) => void;
  convertEligible: boolean;
  onPressConvert: () => void;
  isEditing: boolean;
  onPressDelete: () => void;
  // The red-ghost delete label/icon color (`theme.colors.negative`), threaded
  // in because this is a module-level helper with no Unistyles hook of its own.
  negativeColor: string;
  t: TFunction;
};

const renderModeAndActions = (props: ModeAndActionsProps): ReactElement | null => {
  if (props.converting) {
    return null;
  }

  return (
    <>
      {/* The form's mode as a shared chip row: income/expense always, plus
        Exchange when the source is cash/card and this is a fresh add (see
        `resolveModeOptions`). On a read-only (synced) row the row is
        `disabled`: presses are inert AND the chips dim, matching how the
        other fields render locked, so a synced transaction's bank-owned
        sign cannot be toggled here. */}
      <ChipRow
        options={props.modeOptions}
        selected={props.mode}
        onSelect={props.onSelectMode}
        labels={props.modeLabels}
        disabled={props.isReadOnly}
      />

      {/* The category picker is ALWAYS editable on an income/expense row —
        even on a synced row — since a category edit propagates to every
        same-name transaction and to future imports (decision 3), unlike
        the bank-owned amount/sign. Exchange has no category: both legs'
        descriptions are fixed, auto-generated copy. */}
      {!props.isExchange && (
        <CategoryField
          label={props.t('forms.transaction.category')}
          options={props.categoryOptions}
          selectedKey={props.selectedCategory}
          onSelect={props.onSelectCategory}
          // A category is required only on a fresh add (isSaveDisabled gates a
          // create on it); an edit leaves the category optional.
          required={!props.isEditing}
        />
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

      {props.isEditing && !props.isReadOnly && (
        <Button
          variant="ghost"
          textColor={props.negativeColor}
          size="compact"
          fullWidth={false}
          icon="trash"
          onPress={props.onPressDelete}
        >
          {props.t('common.delete')}
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
  // The account display rank (F2): `accountsRepo.listQuery` is already ordered
  // by the drag-and-drop `sortOrder`, so each account's index IS its rank on
  // the Accounts screen. The picker groups its holdings under their account in
  // this same order (see `compareByAccountThenHolding`).
  const accountOrderById = new Map(accounts.map((account, index) => [account.id, index]));

  // Two entry points: `holdingId` = add a new manual row; `transactionId` = open
  // an existing one. In add mode the by-id query runs against an empty id and
  // returns nothing, keeping the hook order stable without a conditional call.
  const editingId = 'transactionId' in route.params ? route.params.transactionId : null;
  const { data: matchedTransactions } = useLiveQuery(
    transactionsRepo.getByIdQuery(editingId ?? ''),
    ['transactions'],
  );
  const existing = editingId ? matchedTransactions.at(0) : undefined;

  // The category picker's options come from the categories live query (a rename
  // flows straight through), and the confirm copy resolves the picked key to its
  // display title through the same map every screen uses.
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const categoryByKey = buildCategoryDisplayMap(categories);
  const categoryOptions = categories.map((category) => ({
    key: category.key,
    title: categoryByKey.get(category.key)?.title ?? category.title,
    icon: category.icon,
    color: resolveCategoryColor(category.color, category.key),
  }));

  const holdingId =
    existing?.holdingId ?? ('holdingId' in route.params ? route.params.holdingId : undefined);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  // Each money field's trailing currency glyph, keyed off the holding that owns
  // that leg. Empty when the owning holding hasn't resolved/been picked yet, so
  // a not-yet-known currency shows no symbol rather than a wrong one. The source
  // leg (plain amount, Exchange Value Out, and the convert fixed leg) all read
  // the current holding's currency.
  const amountSuffix = holding ? currencySymbol[holding.currency] : '';

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
  const [mode, setMode] = useState<FormMode>('income');
  const isExchange = mode === 'exchange';
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
  const [hydrated, setHydrated] = useState(false);
  // The pending category-override confirmation. Non-null while the themed
  // confirm modal is up (carrying the affected name + picked category key);
  // null when no confirmation is in flight.
  const [pendingOverride, setPendingOverride] = useState<{
    name: string;
    category: string;
  } | null>(null);

  // Seed the fields once, when BOTH the transaction and its holding have loaded
  // (the holding's currency scale is needed to render the amount). The `hydrated`
  // latch keeps a later live-query refresh from clobbering in-progress edits.
  useEffect(() => {
    if (existing && holding && !hydrated) {
      const fields = toAmountFields(currency, existing.amountMinorUnits);
      setAmount(groupAmount(fields.amount));
      // Edit never reaches Exchange (`canExchange` is `false` whenever
      // `isEditing` is `true`), so hydrating straight to the income/expense
      // sign is safe here.
      setMode(fields.sign);
      setDescription(existing.description);
      setTime(existing.time);
      // Lowercase the stored value to a slug key — the same normalization the
      // display resolver applies — so it lines up with the picker's option keys.
      setSelectedCategory(existing.category ? existing.category.toLowerCase() : null);
      setHydrated(true);
    }
  }, [existing, holding, hydrated, currency]);

  // The row's category at open, keyed the same way, so an edit is detectable.
  // Derived (not stored) so it always reflects the persisted value even before
  // the hydration latch closes.
  const originalCategoryKey = existing?.category ? existing.category.toLowerCase() : null;
  const categoryChanged = selectedCategory !== null && selectedCategory !== originalCategoryKey;

  // The description field's placeholder previews the label the row would carry
  // if left blank (see `resolveDescriptionPlaceholder`), and the Save button is
  // disabled for a create still missing its amount or category (see
  // `isSaveDisabled`). Both are module-level pure helpers so their branches
  // stay out of this component's cognitive-complexity budget.
  const descriptionPlaceholder = resolveDescriptionPlaceholder(holding, mode, t);
  const disableSave = isSaveDisabled({
    converting,
    isExchange,
    isReadOnly,
    isEditing,
    amount,
    valueIn,
    counterpartAmount,
    destinationHoldingId,
    counterpartHoldingId,
    selectedCategory,
  });

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
        // `isSaveDisabled` forcing a pick on create.
        category: selectedCategory,
      });
    }
  };

  // Editing a category ALWAYS propagates to every same-name transaction (and to
  // future imports), so surface the blast radius in a themed confirm modal
  // before writing the rule. Both paths return to the list (the manual edit, if
  // any, has already been written); only "Apply" also writes the override rule.
  const applyOverride = async (): Promise<void> => {
    if (pendingOverride === null) {
      return;
    }
    await categoryOverridesRepo.upsertCategoryOverride(
      pendingOverride.name,
      pendingOverride.category,
    );
    navigation.goBack();
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
    await transactionsRepo.setCategory({
      transactionId: editingId,
      category: pendingOverride.category,
    });
    navigation.goBack();
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

  const save = async (): Promise<void> => {
    if (converting) {
      await saveConvert();

      return;
    }

    if (isExchange) {
      await saveExchange();

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
    const overrideRequest = resolveCategoryOverrideRequest(categoryChanged, selectedCategory, name);

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
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  // A manual row can be deleted; the confirm dialog guards the destructive write,
  // and only its "Delete" button runs the removal, then returns to the list.
  const confirmDelete = (): void => {
    if (editingId === null) {
      return;
    }
    Alert.alert(
      t('forms.transaction.deleteConfirmTitle'),
      t('forms.transaction.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await transactionsRepo.remove(editingId);
            navigation.goBack();
          },
        },
      ],
    );
  };

  return (
    <>
      <Screen
        scroll
        footer={
          showsSaveButton(isReadOnly, categoryChanged, converting) ? (
            <Button onPress={onSave} disabled={disableSave || isSubmitting}>
              {t('common.save')}
            </Button>
          ) : undefined
        }
      >
        <Box gap={4}>
          {renderReadOnlyNotice(isReadOnly, theme.colors.surfaceHigh, syncedNotice)}

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
            onSelectCounterpart: setCounterpartHoldingId,
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
            descriptionPlaceholder,
            isReadOnly,
            time,
            onChangeTime: setTime,
            t,
          })}

          {/* The mode chip row, category picker, "Convert to exchange" action,
            and Delete button — everything below the main field group EXCEPT
            while converting. The `!converting` gate and every `&&`-conditional
            live in the module-level `renderModeAndActions` (see above). */}
          {renderModeAndActions({
            converting,
            modeOptions,
            mode,
            onSelectMode: setMode,
            modeLabels,
            isReadOnly,
            isExchange,
            categoryOptions,
            selectedCategory,
            onSelectCategory: setSelectedCategory,
            convertEligible: convertView.eligible,
            onPressConvert: () => setConverting(true),
            isEditing,
            onPressDelete: confirmDelete,
            negativeColor: theme.colors.negative,
            t,
          })}
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
        testID="category-override-sheet"
      >
        <Box direction="row" gap={2} style={styles.confirmHeader}>
          {pendingCategory !== null && (
            <SymbolIcon name={pendingCategory.icon} size={22} tone="textPrimary" />
          )}

          <Text variant="heading">{t('forms.transaction.applyCategoryToAll')}</Text>
        </Box>

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
}));

export default TransactionFormScreen;
