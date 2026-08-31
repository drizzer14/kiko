/**
 * The single native-stack param list for the whole app. Every screen is
 * registered against this map in `root.navigator.tsx`, and screen components
 * type their props with `NativeStackScreenProps<RootStackParamList, 'Name'>`.
 */
export type RootStackParamList = {
  Home: undefined;
  AccountDetail: { accountId: string };
  HoldingDetail: { holdingId: string };
  Settings: undefined;
  AccountForm: { accountId?: string };
  HoldingForm: { accountId: string; holdingId?: string };
  TransactionForm: { holdingId: string };
};
