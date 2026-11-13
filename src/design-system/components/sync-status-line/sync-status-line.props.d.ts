/**
 * The status of a Connect/Save action: idle (nothing), a check in flight, or one of three
 * outcomes carrying the copy to show. The line beside the button shows `checking` and `success`;
 * `invalid` and `saveError` reach the user through `syncErrorMessage` and an `ErrorNotice`.
 * Shared by the Monobank token, wallet address and Binance credentials fields.
 */
export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'success'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'saveError'; message: string };

export type SyncStatusLineProps = { status: SyncStatus };
