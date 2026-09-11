import type { CategoryDisplay } from '@kiko/categories/category-display';
import type { transactionsRepo } from '@kiko/transactions/repo';

// The Home transaction list's row shape — the display projection returned by
// `listAllWithContextQuery`, the same type `useLiveQuery` infers for that query.
// Derived here (rather than re-declared) so the row component and the screen
// stay pinned to the query's own columns.
export type HomeTransactionRow = Awaited<
  ReturnType<typeof transactionsRepo.listAllWithContextQuery>
>[number];

export type TransactionRowProps = {
  item: HomeTransactionRow;
  categoryByKey: ReadonlyMap<string, CategoryDisplay>;
  defaultCategoryKey: string;
  holdingNameById: ReadonlyMap<string, string>;
  categoryKeyForRow: (raw: string | null) => string;
  onPress: (transactionId: string) => void;
};
