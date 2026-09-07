import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Per-tab native-stack param lists. Each tab owns its own stack, so screens
 * type their props with `NativeStackScreenProps<TheStackParamList, 'Name'>`.
 * A screen that reaches across tabs (e.g. Home opening an account form) uses
 * `CompositeScreenProps` with `TabParamList` and the nested screen params.
 */
/**
 * The Transaction form is reached two ways: with a `holdingId` to ADD a new
 * manual transaction to that holding, or with a `transactionId` to open an
 * existing transaction — editable when it is manual, read-only when it was
 * imported from Monobank. The union makes the two entry points mutually
 * exclusive so a caller can never pass both or neither. It is registered in
 * both the Home and Accounts stacks (Home lists every transaction; Accounts
 * reaches it from a holding), so both param lists carry the same shape.
 */
export type TransactionFormParams = { holdingId: string } | { transactionId: string };

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
  HoldingForm: { accountId: string; holdingId?: string };
  TransactionForm: TransactionFormParams;
  // Add a top-up ("contribution") to a term deposit, reached from the holding's
  // detail screen. Bonds record a contribution as a plain TransactionForm entry
  // instead; only deposits take a dedicated contribution form.
  ContributionForm: { holdingId: string };
};

export type SettingsStackParamList = {
  Settings: undefined;
  System: undefined;
  Categories: undefined;
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
