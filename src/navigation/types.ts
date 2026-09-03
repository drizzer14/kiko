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
  AccountDetail: { accountId: string };
  HoldingDetail: { holdingId: string };
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
