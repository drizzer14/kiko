import type { NavigatorScreenParams } from '@react-navigation/native';

import type { StatementFormatId } from '../statement-import/parser';

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

export type HomeStackParamList = {
  Home: undefined;
  TransactionForm: TransactionFormParams;
};

export type AccountsStackParamList = {
  Accounts: undefined;
  // `name` is the entity's name captured at navigation time from the row the
  // user tapped, so the detail screen's native large title (and the back button
  // on any screen pushed from it) shows the name from the FIRST render — before
  // the screen's own live query resolves — with no async title toggle that would
  // briefly blank the back button. The screen still prefers its live-queried
  // name once loaded, so a rename made on the edit form flows back through.
  AccountDetail: { accountId: string; name: string };
  HoldingDetail: { holdingId: string; name: string };
  // The account/holding forms double as CREATE and EDIT screens. An entity id in
  // the params (`accountId` here, `holdingId` on HoldingForm) switches the form
  // to edit mode — it seeds every field from that entity and saves through the
  // update path; absent, the form creates. HoldingForm always carries the owning
  // `accountId` (its kind constrains the offered holding types) whether creating
  // a new holding or editing an existing one.
  AccountForm: { accountId?: string };
  // `returnTo` (item 2, F3 device feedback) is the CREATE-only return channel
  // for a "Create new holding" launched from the statement-import preview or
  // Map Columns: the caller's OWN full route params (so a re-navigate never
  // needs to reconstruct `filePath`/`accountId`/etc. from scratch), tagged
  // with `screen` as a discriminant `save()` narrows with `ts-pattern`
  // (kiko-code-style: exhaustive mapping over a closed literal set) to merge
  // the fresh `newHoldingId` back in — instead of a bare `goBack()` that
  // hands back no id at all. Absent for every other HoldingForm entry point
  // (account-detail's "Add holding", holding-detail's "Edit"), which keep
  // the plain `goBack()`.
  HoldingForm: {
    accountId: string;
    holdingId?: string;
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
  // T16 — `isPricedHoldingType`), reached from the holding-detail screen's
  // "Update value" footer action. A dedicated form, mirroring
  // ContributionForm's shape, rather than a plain TransactionForm entry: a
  // revaluation moves no ledger balance, only the holding's `price_points`
  // series (kiko-domain).
  PricePointForm: { holdingId: string };
  // Record a buy or sell lot against a lot-form-eligible holding (`metal` as
  // of T18, `isLotFormHoldingType` — kiko-pricing/holding-type.ts), reached
  // from the holding-detail screen's "Add lot" footer action. Appends one
  // entry to `metadata.lots` through `holdingsRepo.update`; unlike
  // ContributionForm/PricePointForm it never touches a per-holding
  // `holding:<id>` price series — a metal's price comes from the SHARED
  // `metal:<XAU|...>` instrument (kiko-pricing).
  LotForm: { holdingId: string };
  // The shared statement-import preview + target-holding screen (Phase 1b), reached
  // from the in-app document-picker entry point (`account-detail.screen.tsx`'s
  // `pickAndOpenStatement`) with a resolved local `filePath` and the owning
  // `accountId`. A later entry point (the Share Extension) has no known target
  // account, hence `accountId` is optional here rather than required.
  // `expectedFormatId` (device-feedback-round-1 item 5) scopes recognition
  // to the account's own selected bank when one is known — see
  // `statementFormatIdForBank` (`src/bank-sync/bank-catalog/`). Undefined
  // falls back to the existing multi-format auto-detect (an account with no
  // `bankId`, or the accountId-less Share Extension entry point).
  // `newHoldingId` (item 2, F3 device feedback) is the return-channel param
  // `HoldingFormScreen`'s create-save path merges in via `navigation.navigate`
  // when it was reached through this screen's own "Create new holding" (see
  // `HoldingForm.returnTo` above) — this screen selects it the moment it
  // arrives (a `useEffect` on this field), rather than leaving the freshly
  // created holding unselected even though it already appears in the list.
  StatementImport: {
    filePath: string;
    accountId?: string;
    expectedFormatId?: StatementFormatId;
    newHoldingId?: string;
  };
  // The generic column-mapping import screen (T6), reached from
  // `StatementImportScreen`'s "Map columns manually" entry point (T7) — or
  // navigated to directly when an exact saved mapping is found for a file no
  // shipped parser recognized. `accountId` is required here (unlike
  // `StatementImport` above): a column mapping always saves under this
  // account's own bank/header key, so there is no accountId-less entry point
  // for this screen. `holdingId` (item 11, F3) is the holding already chosen
  // on the statement-import preview — this screen pre-fills its own
  // target-holding field from it instead of asking again; still just a
  // PRE-FILL, not a lock (the field stays editable, and required, like every
  // other required field on this screen). `newHoldingId` is the same
  // "Create new holding" return channel `StatementImport` carries above.
  ColumnMapping: {
    filePath: string;
    accountId: string;
    holdingId?: string;
    newHoldingId?: string;
  };
};

export type SettingsStackParamList = {
  Settings: undefined;
  System: undefined;
  Categories: undefined;
  ExportData: undefined;
  ImportData: undefined;
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
