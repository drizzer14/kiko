import type { transactionsRepo } from '@kiko/transactions/repo';
import type { CategoryDisplay } from '@kiko/categories/category-display';

// The Home transaction list's row shape — the display projection returned by
// `listWithContextBetweenQuery`, the same type `useLiveQuery` infers for that
// query. Derived here (rather than re-declared) so the row component and the
// screen stay pinned to the query's own columns.
export type HomeTransactionRow = Awaited<
  ReturnType<typeof transactionsRepo.listWithContextBetweenQuery>
>[number];

export type TransactionRowProps = {
  item: HomeTransactionRow;
  categoryByKey: ReadonlyMap<string, CategoryDisplay>;
  defaultCategoryKey: string;
  holdingNameById: ReadonlyMap<string, string>;
  holdingCurrencyById: ReadonlyMap<string, string>;
  categoryKeyForRow: (raw: string | null) => string;
  onPress: (transactionId: string) => void;
  // Whether the detail pane shows this row's form: a boolean per row, so a change of the detail
  // route re-renders only the rows whose mark flipped.
  selected: boolean;
  // Open the create form pre-filled from this row. The row offers it only when it is MANUAL and
  // its holding is not synced: a synced row is not duplicable, and a holding a sync owns takes
  // no new row, so the copy would be refused at save.
  onDuplicate: (transactionId: string) => void;
  // Whether the row's own holding is owned by a sync right now. A boolean per row, so a change of
  // the holdings list re-renders only the rows whose answer flipped.
  onSyncedHolding: boolean;
  // Open the account / the holding the row belongs to. Passed for EVERY row, synced or not: a
  // synced row has nothing else to offer, so these two are what its hold opens.
  onViewAccount: (item: HomeTransactionRow) => void;
  onViewHolding: (item: HomeTransactionRow) => void;
};
