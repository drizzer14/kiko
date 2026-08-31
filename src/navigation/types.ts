import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Per-tab native-stack param lists. Each tab owns its own stack, so screens
 * type their props with `NativeStackScreenProps<TheStackParamList, 'Name'>`.
 * A screen that reaches across tabs (e.g. Home opening an account form) uses
 * `CompositeScreenProps` with `TabParamList` and the nested screen params.
 */
export type HomeStackParamList = {
  Home: undefined;
};

export type AccountsStackParamList = {
  Accounts: undefined;
  AccountDetail: { accountId: string };
  HoldingDetail: { holdingId: string };
  AccountForm: { accountId?: string };
  HoldingForm: { accountId: string; holdingId?: string };
  TransactionForm: { holdingId: string };
};

export type SettingsStackParamList = {
  Settings: undefined;
};

/**
 * The native bottom-tab param list. `AccountsTab` carries
 * `NavigatorScreenParams` so a cross-tab `navigate('AccountsTab', { screen,
 * params })` from another tab stays type-safe.
 */
export type TabParamList = {
  HomeTab: undefined;
  AccountsTab: NavigatorScreenParams<AccountsStackParamList>;
  SettingsTab: undefined;
};
