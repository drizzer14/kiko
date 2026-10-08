import type { AccountRow } from '@kiko/db';
import type { HelpTopicId } from '@kiko/help';
import type { ReminderKind } from '@kiko/reminders/schedule';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { StatementFormatId } from '@kiko/statement-import/parser';
import type { ImplicitAccountKind } from '@kiko/holdings/implicit-account';

/**
 * Per-tab native-stack param lists. Each tab owns its own stack, so screens
 * type their props with `NativeStackScreenProps<TheStackParamList, 'Name'>`.
 * A screen that reaches across tabs (e.g. Home opening an account form) uses
 * `CompositeScreenProps` with `TabParamList` and the nested screen params.
 */
/**
 * The Transaction form is reached three ways: with a `holdingId` to ADD a new
 * manual transaction to that holding, with a `transactionId` to open an
 * existing transaction (editable when it is manual, read-only when it was
 * imported from Monobank), or with a `duplicateOfTransactionId` to open the
 * CREATE form pre-filled from an existing manual row (its amount, description,
 * category, and holding), dated to now — a new row on save, never an edit of
 * the source. The union makes the entry points mutually exclusive so a caller
 * can never pass more than one. It is registered in both the Home and Accounts
 * stacks (Home lists every transaction; Accounts reaches it from a holding), so
 * both param lists carry the same shape. The final member — an EMPTY object
 * (`Record<string, never>`) — is the global-add entry (Bundle B): a create with
 * NO holding fixed by navigation, so the form renders its own primary-leg
 * holding picker. `Record<string, never>` admits `{}` alone, keeping every
 * member mutually exclusive (a caller can pass exactly one id, or none at all).
 */
export type TransactionFormParams =
  | { holdingId: string }
  | { transactionId: string }
  | { duplicateOfTransactionId: string }
  | Record<string, never>;

/**
 * The reminder form edits a saved reminder by its id, or creates the one
 * reminder of `kind` an account can have. The union keeps the two entry points
 * mutually exclusive.
 */
export type ReminderFormParams = { reminderId: string } | { accountId: string; kind: ReminderKind };

/**
 * The identity the account form and the implicit holding form carry across the
 * screen swap, so what the user typed before picking a kind survives it. `icon`
 * and `color` are null until the user picked one, so an untouched one keeps
 * following the destination's own default.
 */
export type FormDraft = { name: string; icon: string | null; color: string | null };

/**
 * What every entry to the holding form carries. `implicitKind` (instead of
 * `accountId`) opens the form in implicit create mode: the one property or debt
 * account is found or created on Save, and `draft` seeds the identity the
 * account form carried over. Without the Accounts stack's `returnTo`, so the
 * Home stack, which has no import screen to pop back to, cannot pass one.
 */
type HoldingFormParams = (
  | { accountId: string }
  | { implicitKind: ImplicitAccountKind; draft?: FormDraft }
) & {
  holdingId?: string;
  // Edit only: whether the account holds only debts, so the title reads "Loan"
  // on the first frame; the form reads the account itself when this is absent.
  debtAccount?: boolean;
};

export type HomeStackParamList = {
  Home: undefined;
  TransactionForm: TransactionFormParams;
  // The two create forms an empty holding picker's "Add holding" row opens. They
  // sit in this stack, not behind a switch to the Accounts tab, because leaving
  // the tab resets its stack and the transaction form's draft would go with it.
  AccountForm: AccountsStackParamList['AccountForm'];
  HoldingForm: HoldingFormParams;
};

export type AccountsStackParamList = {
  Accounts: undefined;
  // `name` is the entity's name captured at navigation time from the row the
  // user tapped, so the detail screen's native large title (and the back button
  // on any screen pushed from it) shows the name from the FIRST render — before
  // the screen's own live query resolves — with no async title toggle that would
  // briefly blank the back button. The screen still prefers its live-queried
  // name once loaded, so a rename made on the edit form flows back through.
  // `reminderOffer` is set only by a finished statement import, so the page
  // offers an import reminder then; the page clears it once the offer is
  // decided. `intent: 'importStatement'` is set only by a tap on an import
  // reminder, so the page opens the file picker once, then clears it.
  // `kind` is the account's kind as the navigating screen knows it: until the
  // page's own read of the account lands, it decides the header items (no
  // Reminders bell for an implicit property or debt account), so the bell
  // never shows for a moment and then goes. The loaded account's kind wins.
  AccountDetail: {
    accountId: string;
    name: string;
    kind?: AccountRow['kind'];
    reminderOffer?: 'afterImport';
    intent?: 'importStatement';
  };
  HoldingDetail: { holdingId: string; name: string };
  // The account/holding forms double as CREATE and EDIT screens. An entity id in
  // the params (`accountId` here, `holdingId` on HoldingForm) switches the form
  // to edit mode — it seeds every field from that entity and saves through the
  // update path; absent, the form creates. HoldingForm always carries the owning
  // `accountId` (its kind constrains the offered holding types) whether creating
  // a new holding or editing an existing one.
  // A create form swaps for the holding form when Property or Loan is picked
  // (see `HoldingForm`'s `implicitKind`), and the holding form swaps back when
  // any other kind is picked: `initialKind` and `draft` carry the swap, seeding
  // the form once on mount.
  AccountForm: {
    accountId?: string;
    initialKind?: Exclude<AccountRow['kind'], ImplicitAccountKind>;
    draft?: FormDraft;
  };
  // `returnTo` is the CREATE-only return channel for a "Create new holding"
  // launched from the statement-import preview or Map Columns: the caller's
  // OWN full route params (so a re-`popTo` never needs to reconstruct
  // `filePath`/`accountId`/etc. from scratch), tagged with `screen` as a
  // discriminant `save()` narrows with `ts-pattern` (kiko-code-style:
  // exhaustive mapping over a closed literal set) to
  // `navigation.popTo(screen, { ...params, holdingId }, { merge: true })` —
  // NOT `navigation.navigate`, which on React Navigation 7 PUSHES a
  // duplicate of a route already on the stack instead of reusing it —
  // `popTo` reuses the existing instance in place, keeping its own local
  // state, and merges the fresh `holdingId` into its
  // params); see `src/navigation/root-navigator/statement-import-return.navigator.test.tsx`
  // for the real-router proof. Instead of a bare `goBack()`, which hands
  // back no id at all. Absent for every other HoldingForm entry point
  // (account-detail's "Add holding", holding-detail's "Edit"), which keep
  // the plain `goBack()`.
  HoldingForm: HoldingFormParams & {
    returnTo?:
      | { screen: 'StatementImport'; params: AccountsStackParamList['StatementImport'] }
      | { screen: 'ColumnMapping'; params: AccountsStackParamList['ColumnMapping'] };
  };
  TransactionForm: TransactionFormParams;
  // Add a top-up ("contribution") to a term deposit, reached from the holding's
  // detail screen. Bonds record a contribution as a plain TransactionForm entry
  // instead; only deposits take a dedicated contribution form.
  ContributionForm: { holdingId: string };
  // Record a new `manual` price point for a priced holding (property_item,
  // metal), reached from the holding-detail screen's
  // "Update value" footer action. A dedicated form, mirroring
  // ContributionForm's shape, rather than a plain TransactionForm entry: a
  // revaluation moves no ledger balance, only the holding's `price_points`
  // series (kiko-domain).
  PricePointForm: { holdingId: string };
  // Record a buy or sell lot against a lot-form-eligible holding (`metal` —
  // kiko-pricing), reached from the holding-detail screen's "Add
  // lot" footer action; with `lotIndex`, edit that stored lot, reached from
  // its row's long-press menu. Writes `metadata.lots` through
  // `holdingsRepo.changeLots`, which re-reads the lots inside its write;
  // unlike ContributionForm/PricePointForm it never touches a price series.
  LotForm: { holdingId: string; lotIndex?: number };
  // Edit one stored share change of a property, reached from the holding
  // detail's Share changes list. `day` is the change's `dayKeyOf` key; the
  // repo re-reads the list inside its write rather than trusting a row.
  OwnershipChangeForm: { holdingId: string; day: number };
  // The account's own reminders page, reached from the bell in the account
  // detail header.
  AccountReminders: { accountId: string };
  ReminderForm: ReminderFormParams;
  // The shared statement-import preview + target-holding screen, reached
  // from the in-app document-picker entry point (`account-detail.screen.tsx`'s
  // `pickAndOpenStatement`) with a resolved local `filePath` and the owning
  // `accountId`.
  // `expectedFormatId` scopes recognition to the account's own selected
  // bank when one is known — see `statementFormatIdForBank`
  // (`src/bank-sync/bank-catalog/`). Undefined falls back to the existing
  // multi-format auto-detect (an account with no `bankId`, or `other`).
  // `holdingId` (merged into ONE field so a single field a fresh mount AND a
  // later param change both feed into the SAME "select this holding" effect
  // covers both cases cleanly) is the holding this screen should have
  // selected: either the id `HoldingFormScreen`'s create-save path merges in
  // via `navigation.popTo(screen, { ...params, holdingId }, { merge: true })`
  // when reached through this screen's own "Create new holding" (see
  // `HoldingForm.returnTo` above — `popTo`, NOT `navigate`: React Navigation
  // 7's `navigate()` PUSHES a duplicate of an already-on-stack route instead
  // of reusing it, `popTo` reuses it and merges the params in place), or (on
  // `ColumnMapping` only) the holding already chosen on the statement-import
  // preview, carried through so Map Columns pre-fills instead of asking
  // again. Either way this screen selects it the moment it arrives (a
  // `useEffect` on this field, which also covers the initial-mount prefill
  // case for free) rather than leaving a freshly created holding unselected
  // even though it already appears in the list.
  StatementImport: {
    filePath: string;
    accountId: string;
    expectedFormatId?: StatementFormatId;
    holdingId?: string;
  };
  // The generic column-mapping import screen, reached from
  // `StatementImportScreen`'s "Map columns manually" entry point — or
  // navigated to directly when an exact saved mapping is found for a file no
  // shipped parser recognized. `accountId` is required here, same as
  // `StatementImport` above: a column mapping always saves under this
  // account's own bank/header key. `holdingId` is the SAME merged field `StatementImport`
  // carries above — still just a PRE-FILL/reselect, not a lock (the field
  // stays editable, and required, like every other required field on this
  // screen). `ownsFile` is true ONLY when this
  // screen was reached via the auto-`replace` (no `StatementImport`
  // route left below it on the stack, so THIS screen is the file's sole
  // owner from then on); absent (falsy) on the "Map columns manually"
  // PUSH, where `StatementImport` stays mounted underneath and still owns
  // the file — this screen must never delete it out from under that still-
  // reachable preview. Carried through `HoldingForm.returnTo.params`
  // unchanged on a "Create new holding" round trip, same as every other
  // field here.
  ColumnMapping: {
    filePath: string;
    accountId: string;
    holdingId?: string;
    ownsFile?: boolean;
  };
};

export type SettingsStackParamList = {
  Settings: undefined;
  System: undefined;
  Categories: undefined;
  ExportData: undefined;
  ImportData: undefined;
  Reminders: undefined;
  ReminderForm: ReminderFormParams;
  Help: undefined;
  HelpTopic: { topicId: HelpTopicId };
};

export type StatisticsStackParamList = {
  Statistics: undefined;
};

/**
 * The native bottom-tab param list. `AccountsTab` carries
 * `NavigatorScreenParams` so a cross-tab `navigate('AccountsTab', { screen,
 * params })` from another tab stays type-safe.
 */
export type TabParamList = {
  HomeTab: undefined;
  AccountsTab: NavigatorScreenParams<AccountsStackParamList>;
  StatisticsTab: undefined;
  SettingsTab: undefined;
};
