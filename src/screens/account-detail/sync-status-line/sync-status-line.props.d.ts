/**
 * The result line under a Connect/Save action: idle (nothing), a check in
 * flight, or one of three outcomes carrying the copy to show. Shared by the
 * Monobank token, wallet address and Binance credentials fields.
 */
export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'success'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'saveError'; message: string };

export type SyncStatusLineProps = { status: SyncStatus };
