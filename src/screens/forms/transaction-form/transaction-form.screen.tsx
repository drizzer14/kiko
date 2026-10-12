import {
  type FC,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { useTranslation } from 'react-i18next';
import {
  type CreateHoldingRoute,
  resolveCreateHoldingTarget,
} from '@kiko/screens/forms/create-holding-target';
import {
  type FormHeaderItemsOptions,
  useFormHeaderItems,
} from '@kiko/screens/forms/use-form-header-items';
import { holdingsRepo } from '@kiko/holdings/repo';
import { parseAmount } from '@kiko/currency/parse';
import { StyleSheet } from 'react-native-unistyles';
import Box from '@kiko/design-system/components/box';
import { categoriesRepo } from '@kiko/categories/repo';
import { transactionsRepo } from '@kiko/transactions/repo';
import Screen from '@kiko/design-system/components/screen';
import Button from '@kiko/design-system/components/button';
import { buildRateTable } from '@kiko/rates/net-worth-view';
import { type TextInputInstance, View } from 'react-native';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import { useDataReady, useLiveQuery, type HoldingRow } from '@kiko/db';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import { type Currency, currencySymbol } from '@kiko/currency/currency';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { useScrollToField } from '@kiko/design-system/use-scroll-to-field';
import { seedCounterpartMinorUnits } from '@kiko/holdings/exchange-prefill';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import { transactionTemplatesRepo } from '@kiko/transaction-templates/repo';
import DescriptionSuggestions from '@kiko/screens/forms/description-suggestions';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';
import { isExchangeCreateDestinationType } from '@kiko/holdings/exchange-destination';
import ModeSelectField, { type FormMode } from '@kiko/screens/forms/mode-select-field';

import {
  type SaveDisabledField,
  type SaveDisabledParams,
  type SpecialSaves,
  canSaveSplit,
  firstInvalidField,
  isSplitAmountInvalid,
  MODE_BEHAVIOR,
  resolveActiveMode,
  resolveFieldErrors,
  resolveFieldOrder,
} from './validation';
import {
  type ChangeReturnRow,
  type Sign,
  headerTitle,
  holdingSuffix,
  readOnlyNoticeKey,
  resolveBlankLabel,
  resolveDescriptionPlaceholder,
  signedMinorUnits,
  storedDescription,
} from './row-labels';
import EntryTabs, {
  type EntryTab,
  awaitsTemplatePick,
  resolveSelectedTemplate,
} from './entry-tabs';
import {
  buildExchangeOptions,
  buildLoanOptions,
  buildPrimaryOptions,
  buildReturnOptions,
  isTransactionEligibleType,
  resolveDefaultPrimaryHolding,
} from './holding-options';
import ModeAndActions, {
  isLoanFieldVisible,
  resolveLoanLinkState,
  showsSaveButton,
} from './mode-and-actions';
import CommentRow from './comment-row';
import FieldGroup from './field-group';
import SplitReturns from './split-returns';
import ReadOnlyNotice from './read-only-notice';
import { draftFromForm } from './draft-from-form';
import TemplateNameField from './template-name-field';
import { useCategoryPick } from './use-category-pick';
import { applyHoldingChange } from './holding-change';
import PrimaryHoldingField from './primary-holding-field';
import { resolveTemplateSeed } from './template-references';
import CategoryOverrideSheet from './category-override-sheet';
import { useCategoryOverride } from './use-category-override';
import { applySeedFields, resolveHydration } from './hydration';
import { alongsideInsert, writeTemplate } from './template-save';
import SaveAsTemplate, { resolveTemplateSwitch } from './save-as-template';
import { convertCounterpartType, resolveConvertView } from './convert-view';
import { DEFAULT_MODE, MODE_ICONS, resolveModeOptions } from './mode-options';
import { readRouteEntry, resolveHoldingField, revealsHoldingField } from './route-entry';
import { offersCategoryNameRule, resolveCategoryOverrideRequest } from './category-rule';

// This screen is registered in the Home, Accounts, and Settings stacks (Home lists every
// transaction; Accounts reaches it from a holding; Settings reaches it from the templates
// list), so it cannot bind its props to a single stack's param list. It only needs the route
// params and a few navigation methods (`navigate` for the create forms every stack
// registers), so it declares exactly that minimal shape — structurally satisfied by any
// stack's generated props.
type TransactionFormScreenProps = {
  route: { params: TransactionFormParams };
  navigation: {
    goBack: () => void;
    setOptions: (options: { title: string } | FormHeaderItemsOptions) => void;
    navigate: (...route: CreateHoldingRoute) => void;
    // A template's "Create transaction" opens this same route from the template's own form, so it
    // must push a second entry: a `navigate` to the current route would only swap its params.
    push: (name: 'TransactionForm', params: TransactionFormParams) => void;
  };
};

const TransactionFormScreen: FC<TransactionFormScreenProps> = ({ route, navigation }) => {
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
  // The header's five candidate titles — resolved once per render and handed
  // to `headerTitle` (row-labels/) so it stays translation-agnostic.
  const titleLabels = {
    readOnly: t('forms.transaction.title'),
    editing: t('forms.transaction.editTitle'),
    adding: t('forms.transaction.addTitle'),
    addingTemplate: t('forms.transaction.addTemplateTitle'),
    editingTemplate: t('forms.transaction.editTemplateTitle'),
  };
  const buildApplyCategoryMessage = (category: string, name: string): string =>
    t('forms.transaction.applyCategoryMessage', { category, name });
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major amount to minor units) comes from
  // filtering the full holdings list — the same approach the detail screen uses.
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(holdingsRepo.allQuery(), [
    'holdings',
  ]);
  // The Exchange destination picker's account-name caption:
  // every account, reduced to an id -> name map so `buildExchangeOptions` can
  // thread a plain string onto each holding option without a per-row lookup
  // query.
  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(accountsRepo.listQuery(), [
    'accounts',
  ]);
  // The display name, not the stored one: a loan option sits under the implicit
  // debt account, whose stored name is an English sentinel.
  const accountNameById = new Map(
    accounts.map((account) => [account.id, accountDisplayName(account, t)]),
  );
  // The full account rows keyed by id, so the return picker can ask
  // `isSyncedHolding` whether a candidate's account is connected to a sync
  // — the name/order maps above drop the `institution` that check needs.
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  // The account display rank: `accountsRepo.listQuery` is already ordered
  // by the drag-and-drop `sortOrder`, so each account's index IS its rank on
  // the Accounts screen. The picker groups its holdings under their account in
  // this same order (see `compareByAccountThenHolding`).
  const accountOrderById = new Map(accounts.map((account, index) => [account.id, index]));

  // Six entry points, each named by a route param: `holdingId` = add a new manual row;
  // `transactionId` = open an existing one (edit/read-only); `duplicateOfTransactionId` = open the
  // CREATE form pre-filled FROM an existing manual row; `templateId` = create from a template;
  // `editTemplateId` = edit a template; `newTemplate` = add one. No param is the global add. Read
  // once by a pure helper so the component body spends no `in`-check branch on any of them. In
  // add mode the by-id query runs against an empty id and returns nothing,
  // keeping the hook order stable without a conditional call.
  const {
    editingId,
    duplicateOfId,
    holdingParamId,
    templateQueryId,
    editTemplateId,
    templateEntry,
    isEmptyCreate,
    seedsDefaultHolding,
    hasEntryTabs,
    initialTab,
  } = readRouteEntry(route.params);
  // Adding or editing a template: the form saves a template, not a transaction.
  const isTemplateMode = templateEntry !== null;
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
  // Every stored template, for the name field's case-insensitive "taken" check, the Template tab's
  // select (whose empty-list hint waits for this read to settle), and the one template the route
  // names (to fill from, or to edit), found in it by id. An entry that names none reads an empty id
  // and finds nothing.
  const { data: storedTemplates, isLoading: storedTemplatesLoading } = useLiveQuery(
    transactionTemplatesRepo.listQuery(),
    ['transaction_templates'],
  );

  // The category picker's options come from the categories live query (a rename
  // flows straight through), and the confirm copy resolves the picked key to its
  // display title through the same map every screen uses.
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
  );
  const categoryByKey = buildCategoryDisplayMap(categories);
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

  // The latest cached FX rates, parsed into a
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
  // `holdingParamId`/`existing` supply the holding instead, until a template seats it (a
  // template with a holding sets it, and one with none empties it back to those).
  const [primaryHoldingId, setPrimaryHoldingId] = useState<string | null>(null);
  const holdingId = existing?.holdingId ?? primaryHoldingId ?? holdingParamId ?? undefined;
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  // The holding an add from a holding names, which stays the form's holding whenever the seam is
  // empty again: a template with none of its own falls back to it.
  const pageHolding = holdings.find((candidate) => candidate.id === holdingParamId);
  // Set once a template seats a holding other than the page's, and never cleared (see
  // `revealsHoldingField`): an add from a holding then shows its holding field.
  const [isHoldingFieldRevealed, setHoldingFieldRevealed] = useState(false);
  const holdingField = resolveHoldingField({
    isEmptyCreate,
    isRevealed: isHoldingFieldRevealed,
    holdingId,
  });
  const currency: Currency = holding?.currency ?? 'UAH';
  // Each money field's trailing currency glyph, keyed off the holding that owns
  // that leg. Empty when the owning holding hasn't resolved/been picked yet, so
  // a not-yet-known currency shows no symbol rather than a wrong one. The source
  // leg (plain amount, Exchange Value Out, and the convert fixed leg) all read
  // the current holding's currency.
  const amountSuffix = holding ? currencySymbol[holding.currency] : '';
  // An empty picker's "Add holding" row opens the create form with `navigate`,
  // so this form stays mounted underneath with its draft. A picker tied to this
  // form's own holding creates in that holding's account when that account can
  // create a type the picker lists (`accepts`). A picker that lists one currency
  // only (a return row, in the payer's) passes it on, so the form opens in it.
  const openCreateHoldingIn =
    (
      anchorAccountId: string | undefined,
      accepts: (type: HoldingRow['type']) => boolean,
      pickerCurrency?: Currency,
    ) =>
    (): void => {
      navigation.navigate(
        ...resolveCreateHoldingTarget(
          { anchorAccountId, accepts, currency: pickerCurrency },
          accounts,
        ),
      );
    };

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
    isEmptyCreate: seedsDefaultHolding,
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
  const readOnlyNotice = t(readOnlyNoticeKey(existing?.source));
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
  // The row's current loan link, resolved once and reused everywhere below
  // (options, visibility, and the field's own render props) rather than
  // recomputed inline at each site — that keeps every extra `??`/`?.` this
  // task adds inside the already-budgeted `resolveLoanLinkState` helper
  // instead of this component's own cognitive-complexity count.
  const loanLinkState = resolveLoanLinkState(existing);
  // The loan-payment picker's own eligible options, scoped to the payment's
  // holding currency (see `buildLoanOptions`'s own doc comment). Read here,
  // ahead of the field's `converting`-gated visibility below, alongside every
  // other holdings-derived option list on this screen.
  const loanOptions = buildLoanOptions(
    holdings,
    accountNameById,
    accountOrderById,
    currency,
    loanLinkState.selectedLoanHoldingId,
  );

  const convertView = resolveConvertView(
    existing,
    isEditing,
    holding,
    currency,
    holdings,
    accountNameById,
    accountOrderById,
    accountById,
    holdingId,
    t,
  );

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<FormMode>(DEFAULT_MODE);
  const isExchange = mode === 'exchange';
  const isSplit = mode === 'split';
  const { scrollableRef, onContentSizeChange, scrollTo } = useScrollToField();
  // Per-field wrapper refs, one per validated field, passed to `scrollTo`
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
  // newest, via the SAME occlusion-aware `scrollToField` helper, rather
  // than an unconditional `scrollToEnd`.
  const lastReturnFieldRef = useRef<FieldInstance>(null);
  const amountFieldRef = useRef<FieldInstance>(null);
  // The plain Amount field's own inner input, for a blocked Save's FOCUS
  // follow-up once it has scrolled into view — the ONLY validated field
  // owned directly by this screen (every other field above is a picker with
  // no keyboard, or is owned by ExchangeFields/ConvertExchangeFields, which
  // have no matching focus ref of their own yet).
  const amountInputRef = useRef<TextInputInstance>(null);
  // The template name field's wrapper and inner input, like the Amount field's pair, and the
  // primary holding picker's wrapper (a picker has no keyboard to focus).
  const templateNameFieldRef = useRef<FieldInstance>(null);
  const templateNameInputRef = useRef<TextInputInstance>(null);
  const holdingFieldRef = useRef<FieldInstance>(null);
  const focusByKey: Partial<Record<SaveDisabledField, () => void>> = {
    amount: () => amountInputRef.current?.focus(),
    templateName: () => templateNameInputRef.current?.focus(),
  };
  const fieldRefsByKey: Record<SaveDisabledField, RefObject<FieldInstance | null>> = {
    templateName: templateNameFieldRef,
    holding: holdingFieldRef,
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
  const {
    selectedCategory,
    effectiveCategory,
    userPickedCategory,
    seedCategory,
    selectCategory,
    settleDescription,
    pickSuggestion,
  } = useCategoryPick({
    description,
    setDescription,
    isEditing,
    amount,
    time,
    mode,
    currency: holding?.currency ?? null,
  });
  const [hydrated, setHydrated] = useState(false);
  // Held from the seed rather than re-resolved at Save, so a counterpart
  // renamed mid-edit cannot turn the untouched label into stored text.
  const [prefilledLabel, setPrefilledLabel] = useState<string | null>(null);
  // The template name field: filled by an Edit template, typed in an Add template.
  const [templateName, setTemplateName] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const templateSwitch = resolveTemplateSwitch({
    isOn: saveAsTemplate,
    isReadOnly,
    converting,
    isTemplateMode,
  });
  const blankLabel = resolveBlankLabel({ existing, holding, holdings, t });
  const [tab, setTab] = useState<EntryTab>(initialTab);
  const [pickedTemplateId, setPickedTemplateId] = useState<string | null>(null);
  // The template the Template tab has picked: the select's pick, else the one the route names.
  const { template: selectedTemplate, id: selectedTemplateId } = resolveSelectedTemplate({
    pickedId: pickedTemplateId,
    templates: storedTemplates,
    entryTemplate: storedTemplates.find((template) => template.id === templateQueryId),
  });
  const awaitsPick = awaitsTemplatePick({
    hasEntryTabs,
    tab,
    selectedTemplateId,
    isEntryTemplateLoading: storedTemplatesLoading,
  });
  // A pick is ONE event: it names the template and opens the hydration latch again, and the one
  // hydrate effect below applies the plan. There is no second effect and no second fill path. The
  // template already picked is a no-op, so a stray tap in the sheet costs no edit.
  const pickTemplate = (templateId: string): void => {
    if (templateId === selectedTemplateId) {
      return;
    }

    setPickedTemplateId(templateId);
    setHydrated(false);
  };
  // The template the entry fills from, its references resolved against the live holdings and
  // categories. Held back until all of those reads settle, so nothing resolves against a list that
  // is still loading. The template list needs no gate of its own here: it holds no row until its
  // read settles, so there is no template to resolve.
  const isTemplateReady = useDataReady(holdingsLoading, accountsLoading, categoriesLoading);
  const { templateDraft, templateName: seededTemplateName } = resolveTemplateSeed({
    row: selectedTemplate,
    isReady: isTemplateReady,
    isHydrated: hydrated,
    carriesName: editTemplateId !== null,
    source: {
      holdings,
      accountNameById,
      accountOrderById,
      accountById,
      categoryKeys: categories.map((category) => category.key),
    },
  });
  // Whether the user has pressed Save at least once. Save is always enabled;
  // this latches the inline reason on so it only ever appears after a press
  // that `disableSave` blocked, never live while the user is still filling
  // the form in.
  const [attemptedSave, setAttemptedSave] = useState(false);
  // Seed the fields once, when the source row (edit OR duplicate) and its
  // holding have loaded (the holding's currency scale is needed to render the
  // amount). The `hydrated` latch keeps a later live-query refresh from
  // clobbering in-progress edits. The edit-vs-duplicate decision lives in the
  // pure `resolveHydration` helper, so this effect stays a thin dispatch — a
  // duplicate first seats the `primaryHoldingId` seam (`seedHolding`), then, on
  // the next render once its holding resolves, seeds the copied fields
  // (`seedFields`) dated to NOW. A picked template runs through the same plan. An Edit never
  // reaches Exchange (`canExchange` is `false` whenever `isEditing` is `true`), so a row hydrates
  // straight to its income/expense sign, while a template hydrates the mode it stores
  // (exchange and split included), settled to what its holding offers.
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
      blankLabel,
      templateDraft,
      templateName: seededTemplateName,
      pageHolding,
      holdings,
    });

    match(plan)
      .with({ kind: 'seedHolding' }, (seedHoldingPlan) => {
        setPrimaryHoldingId(seedHoldingPlan.holdingId);
        setHoldingFieldRevealed((revealed) =>
          revealsHoldingField(revealed, holdingParamId, seedHoldingPlan.holdingId),
        );
        // Close the latch only for a FINAL seed (empty-create): `false` is a
        // no-op on the duplicate step (the latch is already open), so this stays
        // a single flat statement rather than another branch.
        setHydrated(seedHoldingPlan.final);
      })
      .with({ kind: 'seedFields' }, (seedFieldsPlan) => {
        applySeedFields(
          seedFieldsPlan,
          {
            setAmount,
            setMode,
            setDescription,
            setPrefilledLabel,
            seedCategory,
            setTime,
            setDestinationHoldingId,
            setValueIn,
            setChangeReturns,
            setPrimaryHoldingId,
            setTemplateName,
          },
          () => nextReturnId.current++,
        );
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
    blankLabel,
    templateDraft,
    seededTemplateName,
    pageHolding,
    holdings,
    holdingParamId,
    seedCategory,
  ]);

  // Seed the counterpart (cash) amount from the latest cached rate at
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

  // The picker is the one place a user changes the primary holding, so a mode the new holding does
  // not offer is settled here, with the same rule the template seed uses.
  const pickPrimaryHolding = (pickedId: string): void => {
    setPrimaryHoldingId(pickedId);

    const picked = holdings.find((candidate) => candidate.id === pickedId);

    if (picked !== undefined) {
      applyHoldingChange(
        picked,
        { mode, destinationHoldingId, holdings },
        { setMode, setDestinationHoldingId, setValueIn, setChangeReturns },
      );
    }
  };

  // The row's category at open, keyed the same way, so an edit is detectable.
  // Derived (not stored) so it always reflects the persisted value even before
  // the hydration latch closes.
  const originalCategoryKey = existing?.category ? existing.category.toLowerCase() : null;
  const categoryChanged = effectiveCategory !== null && effectiveCategory !== originalCategoryKey;
  const offersNameRule = offersCategoryNameRule({ categoryChanged, isEditing, userPickedCategory });

  const loanFieldVisible = isLoanFieldVisible(
    existing?.amountMinorUnits,
    loanOptions.length,
    converting,
    loanLinkState.selectedLoanHoldingId,
  );

  // The description field's placeholder previews the label the row would carry
  // if left blank (see `resolveDescriptionPlaceholder`), and Save is
  // blocked for a create still missing its amount or category (see
  // `MODE_BEHAVIOR`). Both are module-level pure helpers so their
  // branches stay out of this component's cognitive-complexity budget.
  const descriptionPlaceholder = resolveDescriptionPlaceholder({
    holding,
    existing,
    holdings,
    mode,
    t,
  });
  const modeBehavior = MODE_BEHAVIOR[resolveActiveMode(converting, mode)];
  const saveDisabledParams: SaveDisabledParams = {
    isSplit,
    isReadOnly,
    isEditing,
    amount,
    valueIn,
    counterpartAmount,
    destinationHoldingId,
    counterpartHoldingId,
    selectedCategory: effectiveCategory,
    changeReturns,
    currency,
    primaryHoldingId: holdingId ?? null,
    templateName,
    templateNameRequired: templateSwitch.nameRequired,
    isTemplateMode,
    templateNames: storedTemplates,
    editTemplateId,
  };
  // Every field's OWN independent error (see `TransactionFieldErrors`'s own
  // doc comment) — `fieldError` just applies the shared `attemptedSave` gate
  // once here instead of at each of the call sites below.
  const activeMode = resolveActiveMode(converting, mode);
  const activeFieldErrors = resolveFieldErrors(activeMode, saveDisabledParams, t);
  const fieldError = (key: SaveDisabledField): string | undefined =>
    attemptedSave ? activeFieldErrors[key] : undefined;
  // The first still-blocking field, in the active mode's own priority order
  // — both the Save-block gate AND the scroll-to-first-invalid target, so
  // the two can never disagree about which field is blocking.
  const disableSaveField = firstInvalidField(
    resolveFieldOrder(activeMode, saveDisabledParams),
    activeFieldErrors,
  );
  const disableSave = disableSaveField !== null;

  const title = headerTitle(isReadOnly, isEditing, templateEntry, titleLabels);
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const descriptionToStore = storedDescription(description, prefilledLabel);

  // The template the form's fields make, by the same rules a transaction saves by (see
  // `draftFromForm`): saved on its own by a template mode, and along with the transaction by the
  // "save as a new template" switch. The one difference: it stores a category only when the user
  // picked one (or the template being edited or filled in carried one), because a rule pre-select
  // is not the template's own and a later rule change should still move it.
  const buildTemplateDraft = (): TemplateDraft => {
    const destination = holdings.find((candidate) => candidate.id === destinationHoldingId);

    return draftFromForm({
      mode,
      primaryHoldingId: holdingId ?? null,
      currency: holding?.currency ?? null,
      amount,
      description,
      prefilledLabel,
      selectedCategory: userPickedCategory ? effectiveCategory : null,
      destinationHoldingId,
      destinationCurrency: destination?.currency ?? null,
      valueIn,
      changeReturns,
    });
  };

  // The step every transaction write below takes while the switch is on: it saves the template
  // inside that one write. Undefined while it is off.
  const templateAlongside = () =>
    alongsideInsert({
      enabled: templateSwitch.saves,
      name: templateName,
      draft: buildTemplateDraft(),
    });

  // Persist the amount/description edit on a manual row (edit vs. add). Only
  // ever called from the income/expense path (`save` branches Exchange off to
  // `saveExchange` before reaching here), so `mode` is guaranteed a `Sign`.
  // Returns the id of the row it wrote: the edited row's, the created row's, or
  // null when a create had no holding to write to.
  const writeManual = async (): Promise<string | null> => {
    const amountMinorUnits = signedMinorUnits(currency, amount, mode as Sign);

    if (editingId) {
      // Leave the category to the override path below:
      // `transactionsRepo.update` deliberately handles only amount/time/
      // description with its own balance-delta logic, and an edit's category
      // change still routes through the override rule.
      await transactionsRepo.update(
        {
          transactionId: editingId,
          amountMinorUnits,
          time,
          description: descriptionToStore,
        },
        templateAlongside(),
      );

      return editingId;
    }

    if (holdingId) {
      return transactionsRepo.recordManual(
        {
          holdingId,
          amountMinorUnits,
          time,
          description,
          // The row carries its OWN category. The override sheet below governs
          // only whether the pick ALSO propagates to every same-name row; it is
          // not what categorises this row. The override rule alone cannot
          // persist the pick: it returns early on a blank normalized name, so a
          // blank-description row (and any row whose override the user
          // cancelled) would be written uncategorised despite
          // `plainFieldErrors` forcing a pick on create.
          category: effectiveCategory,
          // Only a pick by hand is flagged: a category the rules pre-selected stays
          // free for a later rule rewrite to move.
          categorySetByHand: userPickedCategory,
        },
        templateAlongside(),
      );
    }

    return null;
  };

  // The shared failure alert for every write this screen makes: `save`,
  // `applyOverride`, and `applyOverrideOne` each catch their own write and
  // call this rather than repeating the same two catalog keys three times.
  const showSaveErrorAlert = (): void => {
    alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
  };

  // The loan-payment link persists AT ONCE — no Save-button gating, unlike
  // the category field above (see `LoanPaymentField`'s own doc comment).
  // Both handlers are guarded on `existing` even though the field itself
  // only ever renders once it is defined, so a stray press during the row's
  // own unmount can never throw. A real pick is always `source: 'manual'`;
  // "None" clears the link AND rejects it (`loanLinkRejected`), so the
  // matcher never re-proposes a link the user just explicitly removed — see
  // `transactionsRepo.setLoanPayment`'s own doc comment for the full
  // contract.
  const selectLoanPayment = async (loanHoldingId: string | null): Promise<void> => {
    if (existing === undefined) {
      return;
    }

    try {
      await transactionsRepo.setLoanPayment({ transactionId: existing.id, loanHoldingId });
    } catch {
      showSaveErrorAlert();
    }
  };

  // Undo an auto-suggested link (the matcher's own path): clears it and
  // rejects it too, exactly like a manual "None" — see
  // `transactionsRepo.undoAutoLoanLink`'s own doc comment.
  const undoLoanLink = async (): Promise<void> => {
    if (existing === undefined) {
      return;
    }

    try {
      await transactionsRepo.undoAutoLoanLink(existing.id);
    } catch {
      showSaveErrorAlert();
    }
  };

  const {
    pendingOverride,
    setPendingOverride,
    onApplyOverride,
    isApplyingOverride,
    onApplyOverrideOne,
    isApplyingOverrideOne,
    isOverrideWriting,
    cancelOverride,
    pendingCategory,
    overrideMessage,
  } = useCategoryOverride({
    navigation,
    editingId,
    categoryByKey,
    buildApplyCategoryMessage,
    showSaveErrorAlert,
  });

  // Append an empty return row; `nextReturnId` keeps its React key stable.
  const addReturn = (): void => {
    const id = nextReturnId.current++;

    setChangeReturns((rows) => [...rows, { id, holdingId: null, amount: '' }]);

    // The new row's fields are only measured after this render commits, so
    // defer the scroll to the next frame — otherwise `lastReturnFieldRef`
    // would still measure the PRE-add (one row shorter) layout. Same
    // deferred-RAF pattern as the categories screen's own
    // `scrollToAddCategoryForm`. Routes through the SAME occlusion-aware
    // `scrollToField` helper `save`'s own scroll-to-invalid uses below —
    // never an unconditional `scrollToEnd`, which would fire even when the
    // new row was already fully on screen.
    requestAnimationFrame(() => {
      scrollTo(lastReturnFieldRef);
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
  // currency holding (the payer itself included), minus every holding
  // already picked in ANOTHER row, so two rows can never target the same holding
  // through the UI, and minus any synced/syncable holding.
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

    await transactionsRepo.recordManualWithReturns(
      {
        payment: {
          holdingId: holding.id,
          amountMinorUnits: -paymentMinor,
          time,
          description,
          category: effectiveCategory,
          categorySetByHand: userPickedCategory,
        },
        returns: changeReturns.map((change) => ({
          holdingId: change.holdingId as string,
          amountMinorUnits: Money.fromMajor(holding.currency, parseAmount(change.amount))
            .minorUnits,
        })),
      },
      templateAlongside(),
    );

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

    await transactionsRepo.recordExchange(
      {
        sourceHoldingId: holding.id,
        valueOutMinorUnits: valueOut.minorUnits,
        destinationHoldingId: destination.id,
        destinationType: destination.type,
        valueInMinorUnits: valueInMoney.minorUnits,
        time,
      },
      templateAlongside(),
    );

    navigation.goBack();
  };

  // The convert save path: writes ONLY the missing counterpart leg via
  // `recordExchangeCounterpart`; the existing row gets only the pair id (plus
  // the marker when it is manual or imported). Extracted
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
  // the manual edit. Returns the written row's id, or null when the amount was
  // rejected, so `save` can abort the whole flow (including the category confirm
  // below) on a bad amount without its own nested branch. A synced row is
  // bank-owned: only its category may change, so it skips the amount write
  // entirely and hands back its own id for the category confirm.
  //
  // The magnitude test is the same `<= 0` rejection `saveExchange` and
  // `saveConvert` already apply. Testing only empty/NaN let `"0"` through and
  // created a 0.00 row, contradicting this guard's own "no zero-amount row"
  // claim. The user's income/expense chip carries the sign, so the typed
  // magnitude is always non-negative here — `<= 0` means "zero".
  const tryWriteManual = async (): Promise<{ rowId: string | null } | null> => {
    if (isReadOnly) {
      return { rowId: editingId };
    }

    const magnitude = parseAmount(amount);

    if (amount.trim() === '' || Number.isNaN(magnitude) || magnitude <= 0) {
      return null;
    }

    return { rowId: await writeManual() };
  };

  // The three non-manual save modes, dispatched ahead of the income/expense
  // path. Returns whether one of them handled the write, so `save` stays a
  // single early-return without carrying all three branches in its own
  // cognitive-complexity budget.
  const dispatchSpecialSave = async (): Promise<boolean> => {
    const { save: saveSpecial } = modeBehavior;

    // A template mode saves its draft whichever mode is selected, so it goes first.
    if (isTemplateMode) {
      await saveTemplate();

      return true;
    }

    if (saveSpecial === null) {
      return false;
    }

    const saves: SpecialSaves = {
      convert: saveConvert,
      split: saveSplit,
      exchange: saveExchange,
    };

    await saves[saveSpecial]();

    return true;
  };

  // The outer Save gate: Save is always enabled, so a press while
  // `disableSave` is true latches `attemptedSave` (surfacing the inline
  // reason) and scrolls to the first invalid field instead of writing
  // anything. Kept as a thin wrapper around `performSave` — folding the gate
  // into `performSave` itself pushes that function's cognitive complexity
  // over Biome's ceiling.
  const save = async (): Promise<void> => {
    // The nav-bar Save does not end editing, so the description may never have blurred; commit
    // its rule category to the picker, which `effectiveCategory` below already acts on.
    settleDescription();

    if (disableSave) {
      setAttemptedSave(true);

      if (disableSaveField) {
        scrollTo(fieldRefsByKey[disableSaveField], focusByKey[disableSaveField]);
      }

      return;
    }

    await performSave();
  };

  // The template modes' save: the draft built from the form, written as a new template or over the
  // one being edited. No transaction is written and the category override sheet never opens. A
  // failed write rejects into `performSave`'s catch, like every other write here.
  const saveTemplate = async (): Promise<void> => {
    await writeTemplate({ editTemplateId, name: templateName, draft: buildTemplateDraft() });

    navigation.goBack();
  };

  const performSave = async (): Promise<void> => {
    try {
      if (await dispatchSpecialSave()) {
        return;
      }

      const written = await tryWriteManual();

      if (written === null) {
        return;
      }

      // The rule keys on the synced row's own description (read-only) or the
      // just-saved manual description.
      const name = isReadOnly ? (existing?.description ?? '') : descriptionToStore;
      const overrideRequest = resolveCategoryOverrideRequest(
        offersNameRule,
        effectiveCategory,
        name,
        written.rowId,
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
      // path (`resolveCategoryOverrideRequest` -> `applyNameRule`) stays
      // intact, so a catch-all rule is still refused. A create (no `editingId`)
      // already carries its category from `recordManual`, so it is excluded.
      if (editingId !== null && categoryChanged && effectiveCategory !== null) {
        await transactionsRepo.setCategory({
          transactionId: editingId,
          category: effectiveCategory,
        });
      }

      navigation.goBack();
    } catch {
      // Every write above — recordManual/recordManualWithReturns/recordExchange/
      // recordExchangeCounterpart/update/setCategory — can reject; unhandled,
      // the screen would silently fail to navigate, with Save re-enabled and
      // no explanation. Mirror the established Alert pattern instead.
      showSaveErrorAlert();
    }
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  useFormHeaderItems({
    navigation,
    onSave,
    hasSave: showsSaveButton(isReadOnly, categoryChanged, converting, awaitsPick),
    isSaving: isSubmitting,
  });

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
        onContentSizeChange={onContentSizeChange}
        footer={foldMap(maybe(editTemplateId), (templateId) => (
          // Create transaction opens the template as it is STORED: the unsaved edits on this
          // form are neither used nor saved. Save is the nav bar's, like every other form's, so
          // this lone secondary action is the whole footer.
          <Button
            variant="secondaryTonal"
            onPress={() => {
              navigation.push('TransactionForm', { templateId });
            }}
            icon={genericEntitySymbol.transaction}
          >
            {t('forms.transaction.createTransaction')}
          </Button>
        ))}
      >
        <Box gap={4} testID="transaction-form">
          {/* The Manual and Template tabs sit on top of the form, which they gate: the Template
            tab holds the whole form back until a template is picked. A tab switch only shows or
            hides it, so no value (all of it lives in this screen's state) is lost. */}
          <EntryTabs
            visible={hasEntryTabs}
            tab={tab}
            onSelectTab={setTab}
            awaitsPick={awaitsPick}
            templates={storedTemplates}
            templatesLoading={storedTemplatesLoading}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplate={pickTemplate}
          >
            <ReadOnlyNotice isReadOnly={isReadOnly} noticeText={readOnlyNotice} />

            {/* A template mode's name field goes on top, above the holding picker. */}
            <TemplateNameField
              visible={isTemplateMode}
              value={templateName}
              onChangeText={setTemplateName}
              error={fieldError('templateName')}
              fieldRef={templateNameFieldRef}
              inputRef={templateNameInputRef}
            />

            {/* B: the primary-leg holding picker, shown when no holding was fixed by
            navigation (the global-add entry), and on an add from a holding once a
            template has seated another one. It drives the shared `primaryHoldingId`
            seam, so the currency/category/exchange derivation below follows the pick
            automatically. Null on every other path. */}
            <PrimaryHoldingField
              visible={holdingField.visible}
              label={t('forms.transaction.holding')}
              sheetTitle={t('forms.transaction.holdingSheetTitle')}
              placeholder={t('forms.transaction.selectHolding')}
              options={primaryOptions}
              selectedId={holdingField.selectedId}
              onSelect={pickPrimaryHolding}
              onCreateNew={openCreateHoldingIn(undefined, isTransactionEligibleType)}
              error={fieldError('holding')}
              fieldRef={holdingFieldRef}
            />

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
            The three-way switch lives in `FieldGroup` rather than a nested
            ternary here. */}
            <FieldGroup
              converting={converting}
              convertView={convertView}
              counterpartHoldingId={counterpartHoldingId}
              onSelectCounterpart={selectCounterpart}
              onCreateCounterpart={openCreateHoldingIn(
                holding?.accountId,
                convertCounterpartType(convertView.direction),
              )}
              counterpartAmount={counterpartAmount}
              onChangeCounterpartAmount={(text) => setCounterpartAmount(groupAmount(text))}
              isExchange={isExchange}
              amount={amount}
              onChangeAmount={(text) => setAmount(groupAmount(text))}
              amountSuffix={amountSuffix}
              // The fixed convert leg is the existing transaction's own holding,
              // so it shares the source holding's currency glyph.
              fixedSuffix={amountSuffix}
              destinationOptions={destinationOptions}
              destinationHoldingId={destinationHoldingId}
              onSelectDestination={setDestinationHoldingId}
              onCreateDestination={openCreateHoldingIn(
                holding?.accountId,
                isExchangeCreateDestinationType,
              )}
              valueIn={valueIn}
              onChangeValueIn={(text) => setValueIn(groupAmount(text))}
              valueInSuffix={holdingSuffix(holdings, destinationHoldingId)}
              counterpartSuffix={holdingSuffix(holdings, counterpartHoldingId)}
              description={description}
              onChangeDescription={setDescription}
              onBlurDescription={settleDescription}
              // The inline suggestion row. Its pool is already empty on an
              // edit (see the `pastDescriptions` memo), and the component itself
              // hides when there is no match or the field already equals a
              // suggestion, so it is passed unconditionally here.
              descriptionSuggestions={
                <DescriptionSuggestions
                  descriptions={pastDescriptions}
                  value={description}
                  onPick={pickSuggestion}
                />
              }
              descriptionPlaceholder={descriptionPlaceholder}
              isReadOnly={isReadOnly}
              time={time}
              onChangeTime={setTime}
              maxDate={Date.now()}
              showsDate={!isTemplateMode}
              required={!isTemplateMode}
              t={t}
              amountError={fieldError('amount')}
              amountInvalid={isSplitAmountInvalid(saveDisabledParams, attemptedSave)}
              amountFieldRef={amountFieldRef}
              amountInputRef={amountInputRef}
              valueOutError={fieldError('valueOut')}
              destinationError={fieldError('destinationHolding')}
              valueInError={fieldError('valueIn')}
              valueOutFieldRef={valueOutFieldRef}
              destinationFieldRef={destinationFieldRef}
              valueInFieldRef={valueInFieldRef}
              counterpartError={fieldError('counterpartHolding')}
              counterpartAmountError={fieldError('counterpartAmount')}
              counterpartFieldRef={counterpartHoldingFieldRef}
              counterpartAmountFieldRef={counterpartAmountFieldRef}
            />

            {/* Split-change only: the dynamic return rows + "Add return" action,
            rendered below the reused Amount/Description/Date/Time group. The
            `visible` gate and the `.map` live in `SplitReturns`, so this stays
            a single element. Wrapped in `splitReturnsFieldRef` here (the CALL
            SITE) rather than inside the component, so the ref anchors the whole
            section for scroll-to-invalid.
            `SplitReturns` renders `null` in every non-split mode, but
            this wrapper `View` still counts as a flex item in the parent
            `Box`'s `gap` layout — `styles.hidden` (`display: 'none'`) keeps a
            hidden wrapper out of that gap slot while the mode is not split,
            without unmounting it (so the ref stays usable the moment split
            mode is selected).
            This wrapper stands in place of `SplitReturns`'s Fragment as
            a DIRECT child of the parent `Box gap={4}`: its
            divider/heading/rows/error/button are wrapped in this one `View`
            as ONE child, with nothing supplying a gap between them the way
            the Box's own direct children would each get automatically.
            `styles.splitReturnsGap` gives this wrapper the SAME gap
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
              <SplitReturns
                visible={isSplit}
                returns={changeReturns}
                buildOptions={returnOptionsFor}
                onSelectHolding={selectReturnHolding}
                onCreateHolding={openCreateHoldingIn(
                  holding?.accountId,
                  isTransactionEligibleType,
                  holding?.currency,
                )}
                onChangeAmount={changeReturnAmount}
                onRemove={removeReturn}
                onAdd={addReturn}
                suffix={amountSuffix}
                selectHoldingPlaceholder={t('forms.transaction.selectHolding')}
                required={!isTemplateMode}
                t={t}
                error={fieldError('splitReturns')}
                lastRowRef={lastReturnFieldRef}
              />
            </View>

            {/* The mode chip row, category picker, and "Convert to exchange"
            action — everything below the main field group EXCEPT while
            converting. The `!converting` gate and every `&&`-conditional
            live in `ModeAndActions`. */}
            <ModeAndActions
              converting={converting}
              isReadOnly={isReadOnly}
              isExchange={isExchange}
              categoryOptions={categoryOptions}
              selectedCategory={selectedCategory}
              onSelectCategory={selectCategory}
              convertEligible={convertView.eligible}
              onPressConvert={() => setConverting(true)}
              categoryRequired={!(isEditing || isTemplateMode)}
              t={t}
              categoryError={fieldError('selectedCategory')}
              categoryFieldRef={categoryFieldRef}
              loanFieldVisible={loanFieldVisible}
              loanOptions={loanOptions}
              {...loanLinkState}
              onSelectLoanPayment={selectLoanPayment}
              onUndoLoanLink={undoLoanLink}
            />

            {/* After description AND category — the top of the form (above
              holding/type/amount) reads wrong for a supplementary,
              often-empty field. */}
            <CommentRow comment={existing?.comment} label={t('forms.transaction.comment')} />

            {/* The last thing in the form body, so a native Save in the nav bar can take the
              footer's place without moving it. Its name field shows right below it while on. */}
            <SaveAsTemplate
              visible={templateSwitch.visible}
              isOn={saveAsTemplate}
              onToggle={setSaveAsTemplate}
              name={templateName}
              onChangeName={setTemplateName}
              error={fieldError('templateName')}
              nameFieldRef={templateNameFieldRef}
              nameInputRef={templateNameInputRef}
            />
          </EntryTabs>
        </Box>
      </Screen>

      <CategoryOverrideSheet
        visible={pendingOverride !== null}
        onDismiss={cancelOverride}
        categoryIcon={pendingCategory?.icon ?? null}
        message={overrideMessage}
        canApplyToOne={editingId !== null}
        onApply={onApplyOverride}
        isApplying={isApplyingOverride}
        onApplyOne={onApplyOverrideOne}
        isApplyingOne={isApplyingOverrideOne}
        isWriting={isOverrideWriting}
      />
    </>
  );
};

const styles = StyleSheet.create((theme) => ({
  // Keeps the split-returns wrapper out of the parent `Box`'s `gap` layout
  // while `SplitReturns` renders `null` (every non-split mode) — RN
  // excludes a `display: 'none'` view from flex/gap layout entirely, unlike
  // an empty rendered child, which still counts as a flex item and doubles
  // the gap on both sides of it. The node (and its ref) stay mounted, so
  // `splitReturnsFieldRef` is still usable the instant split mode is picked.
  hidden: {
    display: 'none',
  },
  // The wrapper's own gap, matching the
  // parent form `Box`'s `gap={4}` rhythm — see the CALL SITE comment above
  // for why this wrapper (not `SplitReturns` itself) owns it.
  splitReturnsGap: {
    gap: theme.spacing(4),
  },
}));

export default TransactionFormScreen;
