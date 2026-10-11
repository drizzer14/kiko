import {
  type Repository,
  type CategoryRuleRow,
  database,
  write,
  id,
  categoryRules,
  holdings,
  transactions,
  chunkRows,
  IN_CLAUSE_CHUNK_SIZE,
} from '@kiko/db';
import {
  type CategoryRuleMatcher,
  type PreparedRule,
  matcherSetKey,
  matchesRule,
  planRuleRewrite,
  prepareRules,
} from '@kiko/categories/category-rules';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

const REWRITE_PAGE_SIZE = 2000;

const isNameMatcher = (matcher: CategoryRuleMatcher): boolean =>
  matcher.type === 'nameIs' || matcher.type === 'nameStartsWith';

// Every reader of the rules (the insert path, the rewrite, the rule write) needs every rule, so
// the read has no `where` and no cap: a rule dropped from it would be a category silently not
// applied. The table is small and written only by the user.
export const readAllRulesDatabaseTransaction = (
  databaseTransaction: typeof database,
): Promise<CategoryRuleRow[]> => databaseTransaction.select().from(categoryRules);

const candidateColumns = {
  id: transactions.id,
  description: transactions.description,
  amountMinorUnits: transactions.amountMinorUnits,
  time: transactions.time,
  currency: holdings.currency,
  category: transactions.category,
  categorySetByHand: transactions.categorySetByHand,
  exchangePairId: transactions.exchangePairId,
  exchangeCounterpartHoldingId: transactions.exchangeCounterpartHoldingId,
  setsBalance: transactions.setsBalance,
  changeGroupId: transactions.changeGroupId,
};

// The two candidate reads below filter on nothing but the description list or the id keyset:
// `planRuleRewrite` leaves out the rows a rule may not touch (picked by hand, exchange legs,
// balance-setting and split-change rows). An `IS NULL` on the exchange column in the SQL would
// make the planner walk the full `transactions_exchange_pair_id` index and sort the page, instead
// of reading the primary key in order.
export const rewriteDescriptionRowsQuery = (
  databaseTransaction: typeof database,
  descriptions: string[],
) =>
  databaseTransaction
    .select(candidateColumns)
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(inArray(transactions.description, descriptions));

export const rewritePageQuery = (databaseTransaction: typeof database, afterId: string) =>
  databaseTransaction
    .select(candidateColumns)
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(gt(transactions.id, afterId))
    .orderBy(asc(transactions.id))
    .limit(REWRITE_PAGE_SIZE);

type PreparedRules = ReturnType<typeof prepareRules>;

// A saved rule with a name matcher can only win rows whose description normalizes to what that
// matcher accepts, so only those descriptions are read as rows. The pure module judges the name,
// on a subject that knows nothing else, so this narrowing never differs from the rule itself.
const rowIdsForNamedRule = async (
  databaseTransaction: typeof database,
  prepared: PreparedRules,
  nameOnlyRule: PreparedRule,
): Promise<string[]> => {
  const descriptionRows = await databaseTransaction
    .selectDistinct({ description: transactions.description })
    .from(transactions);
  const descriptions = descriptionRows
    .map((row) => row.description)
    .filter((description) =>
      matchesRule(nameOnlyRule, {
        normalizedName: normalizeTransactionName(description),
        absoluteMinorUnits: null,
        currency: null,
        direction: null,
        minuteOfDay: null,
      }),
    );
  const rowIds: string[] = [];

  for (const descriptionChunk of chunkRows(descriptions, IN_CLAUSE_CHUNK_SIZE)) {
    const rows = await rewriteDescriptionRowsQuery(databaseTransaction, descriptionChunk);

    for (const rowId of planRuleRewrite(prepared, nameOnlyRule.id, rows)) {
      rowIds.push(rowId);
    }
  }

  return rowIds;
};

// A rule with no name matcher can win any row, so every row is read; planRuleRewrite picks the
// rewritable ones. A page of ids at a time (an id-keyset page, so a page never re-reads or skips a
// row).
const rowIdsForUnnamedRule = async (
  databaseTransaction: typeof database,
  prepared: PreparedRules,
  savedRuleId: string,
): Promise<string[]> => {
  const rowIds: string[] = [];
  let lastId = '';
  let pageLength = REWRITE_PAGE_SIZE;

  while (pageLength === REWRITE_PAGE_SIZE) {
    const page = await rewritePageQuery(databaseTransaction, lastId);

    for (const rowId of planRuleRewrite(prepared, savedRuleId, page)) {
      rowIds.push(rowId);
    }

    pageLength = page.length;
    lastId = page.at(-1)?.id ?? lastId;
  }

  return rowIds;
};

/**
 * Writes the saved rule's category onto every row that rule wins today, on the caller's own
 * transaction, and returns how many rows changed. Rows are planned from the rows as they stand
 * inside the write, so the count is exact even when a sync landed after the user saw a number.
 * It never reverts a row: a row the rule does not win keeps the category it has.
 */
export const rewriteForRuleDatabaseTransaction = async (
  databaseTransaction: typeof database,
  savedRuleId: string,
): Promise<number> => {
  const prepared = prepareRules(await readAllRulesDatabaseTransaction(databaseTransaction));
  const savedRule = prepared.ordered.find((rule) => rule.id === savedRuleId);

  if (savedRule === undefined) {
    return 0;
  }

  const nameMatchers = savedRule.matchers.filter(isNameMatcher);
  const rowIds =
    nameMatchers.length > 0
      ? await rowIdsForNamedRule(databaseTransaction, prepared, {
          ...savedRule,
          matchers: nameMatchers,
        })
      : await rowIdsForUnnamedRule(databaseTransaction, prepared, savedRuleId);

  for (const rowIdChunk of chunkRows(rowIds, IN_CLAUSE_CHUNK_SIZE)) {
    await databaseTransaction
      .update(transactions)
      .set({ category: savedRule.category })
      .where(and(inArray(transactions.id, rowIdChunk), eq(transactions.categorySetByHand, false)));
  }

  return rowIds.length;
};

// The row the user is editing always ends in the category they picked, whatever kind of row it is:
// the rewrite never touches an exchange leg, a balance-setting row or a split-change row, so the
// category cannot arrive through it. Returns 1 when the category changed, because the rewrite
// skips a row that already holds the picked category and would not count this one.
const giveSourceRowCategory = async (
  databaseTransaction: typeof database,
  sourceTransactionId: string,
  category: string,
): Promise<number> => {
  const [source] = await databaseTransaction
    .select({ category: transactions.category })
    .from(transactions)
    .where(eq(transactions.id, sourceTransactionId));

  await databaseTransaction
    .update(transactions)
    .set({ category, categorySetByHand: false })
    .where(eq(transactions.id, sourceTransactionId));

  return source !== undefined && source.category !== category ? 1 : 0;
};

export const categoryRulesRepo = {
  /**
   * Every rule as a reactive Drizzle builder (never executed data), handed to useLiveQuery so the
   * form can prepare the rules once and pre-select a category from the typed description.
   */
  allQuery: () => database.select().from(categoryRules),
  /**
   * How many rules a category delete takes with it. Every stored rule counts, a rule that can no
   * longer be read included, and the key matches case-insensitively, exactly as the delete does,
   * so the confirm never reports fewer rules than the delete removes.
   */
  countRulesOfCategory: async (key: string): Promise<number> => {
    const [row] = await database
      .select({ value: sql<number>`count(*)` })
      .from(categoryRules)
      .where(sql`lower(${categoryRules.category}) = ${key.toLowerCase()}`);

    return row?.value ?? 0;
  },
  // Removes the rule alone: a rule never owns a transaction's category, so no row changes.
  deleteRule: (ruleId: string) =>
    write((databaseTransaction) =>
      databaseTransaction.delete(categoryRules).where(eq(categoryRules.id, ruleId)),
    ),
  /**
   * Makes `name` -> `category` a rule and rewrites every existing row that rule wins, all in ONE
   * write so a partial failure can never leave the rule and the ledger disagreeing. A rule that
   * is already exactly this name moves to the new category (it keeps its id and is now the newest
   * rule, so the user's latest choice wins a tie); a rule with other conditions beside this name
   * is a different rule and is left alone. The row the user is editing gets the picked category
   * and is freed from its by-hand mark, because it now follows the rule. A blank name is a no-op:
   * it must not become a catch-all.
   *
   * Categories are keyed by a stable slug, so a later category rename only changes its title.
   */
  applyNameRule: (input: { name: string; category: string; sourceTransactionId: string | null }) =>
    write(async (databaseTransaction) => {
      if (normalizeTransactionName(input.name) === '') {
        return 0;
      }

      const matchers: CategoryRuleMatcher[] = [{ type: 'nameIs', text: input.name.trim() }];
      const prepared = prepareRules(await readAllRulesDatabaseTransaction(databaseTransaction));
      const wantedKey = matcherSetKey(matchers);
      const existingRule = prepared.ordered.find(
        (rule) => matcherSetKey(rule.matchers) === wantedKey,
      );
      const savedRuleId = existingRule?.id ?? id();
      const now = Date.now();

      if (existingRule === undefined) {
        await databaseTransaction.insert(categoryRules).values({
          id: savedRuleId,
          category: input.category,
          matchers: JSON.stringify(matchers),
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await databaseTransaction
          .update(categoryRules)
          .set({ category: input.category, matchers: JSON.stringify(matchers), updatedAt: now })
          .where(eq(categoryRules.id, savedRuleId));
      }

      const sourceMoved =
        input.sourceTransactionId === null
          ? 0
          : await giveSourceRowCategory(
              databaseTransaction,
              input.sourceTransactionId,
              input.category,
            );

      return (
        sourceMoved + (await rewriteForRuleDatabaseTransaction(databaseTransaction, savedRuleId))
      );
    }),
} satisfies Repository;
