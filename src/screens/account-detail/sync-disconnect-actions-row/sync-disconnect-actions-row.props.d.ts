/**
 * The shared Sync + Disconnect action row for a connected bank/crypto
 * account — both `bank-sync-section` and `crypto-sync-section` render the
 * IDENTICAL pair (both take the `secondaryTonal` Button variant), differing
 * only in what each button's own `onPress` does and this row's `testID`.
 */
export type SyncDisconnectActionsRowProps = {
  onSync: () => void;
  isSyncing: boolean;
  onDisconnect: () => void;
  testID: string;
};
