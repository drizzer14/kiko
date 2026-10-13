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
  isSameCategory,
  matcherSetKey,
  matchesRule,
  parseRuleMatchers,
  planRuleRewrite,
  prepareRules,
  subjectOfStoredRow,
  validateRule,
  winningRule,
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

// A rule as the editor holds it: no id yet for a new rule.
type RuleDraft = {
  id: string | null;
  category: string;
  matchers: readonly CategoryRuleMatcher[];
};

// A rule saved again exactly as it is stored has nothing to write and nothing to rewrite, so
// neither the count nor the save looks at the ledger for it. The category compares without case,
// as the page that opened the editor found the rule.
const isStoredAsGiven = (stored: CategoryRuleRow | undefined, draft: RuleDraft): boolean =>
  stored !== undefined &&
  isSameCategory(stored.category, draft.category) &&
  JSON.stringify(parseRuleMatchers(stored.matchers)) === JSON.stringify(draft.matchers);

// The row the draft becomes: a new rule is created now, an edited one keeps its creation time, and
// either way it is the newest of its strength, which is what decides a tie.
const rowOfDraft = (
  stored: CategoryRuleRow | undefined,
  draft: RuleDraft,
  now: number,
): CategoryRuleRow => ({
  id: stored?.id ?? draft.id ?? id(),
  category: draft.category,
  matchers: JSON.stringify(draft.matchers),
  createdAt: stored?.createdAt ?? now,
  updatedAt: now,
});

const withRow = (rows: readonly CategoryRuleRow[], row: CategoryRuleRow): CategoryRuleRow[] => [
  ...rows.filter((existing) => existing.id !== row.id),
  row,
];

// The draft against the stored rules: its stored self (if any), the row it becomes, and every rule
// prepared with that row in place of the stored one (or added), so the rewrite is judged on the
// rules as they will stand.
const stageDraft = (rows: readonly CategoryRuleRow[], draft: RuleDraft) => {
  const stored = rows.find((existing) => existing.id === draft.id);
  const row = rowOfDraft(stored, draft, Date.now());

  return { stored, row, prepared: prepareRules(withRow(rows, row)) };
};

const storeRule = async (
  databaseTransaction: typeof database,
  stored: CategoryRuleRow | undefined,
  row: CategoryRuleRow,
): Promise<void> => {
  if (stored === undefined) {
    await databaseTransaction.insert(categoryRules).values(row);
  } else {
    await databaseTransaction
      .update(categoryRules)
      .set({ category: row.category, matchers: row.matchers, updatedAt: row.updatedAt })
      .where(eq(categoryRules.id, row.id));
  }
};

// Why a rule may not be saved, or undefined when it may. A rule that could not be read back (a
// blank name, a negative amount) would be stored but never match, so it is refused too.
const refusalOf = (draft: RuleDraft, otherRules: readonly PreparedRule[]): string | undefined => {
  const validation = validateRule(draft.matchers, otherRules, draft.id);

  if (validation.kind !== 'valid') {
    return validation.kind;
  }

  return parseRuleMatchers(JSON.stringify(draft.matchers)) === null ? 'unreadable' : undefined;
};

const assertSavable = (refusal: string | undefined): void => {
  if (refusal !== undefined) {
    throw new Error(`categoryRulesRepo.saveRule: ${refusal}`);
  }
};

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

// The rows a rule would change, from the rules as they are given: the count in the confirm sheet
// and the write behind "Apply to existing" both ask this one question, so the number promised is
// the number written whenever the ledger has not moved between them.
const rowIdsRewrittenBy = async (
  databaseTransaction: typeof database,
  prepared: PreparedRules,
  savedRule: PreparedRule,
): Promise<string[]> => {
  const nameMatchers = savedRule.matchers.filter(isNameMatcher);

  return nameMatchers.length > 0
    ? rowIdsForNamedRule(databaseTransaction, prepared, { ...savedRule, matchers: nameMatchers })
    : rowIdsForUnnamedRule(databaseTransaction, prepared, savedRule.id);
};

const preparedRuleOf = (prepared: PreparedRules, ruleId: string): PreparedRule | undefined =>
  prepared.ordered.find((rule) => rule.id === ruleId);

// Writes the saved rule's category onto every row that rule wins, planned from the rows as they
// stand inside the write, so the count is exact even when a sync landed after the user saw a
// number. It never reverts a row: a row the rule does not win keeps the category it has.
const rewriteWithPreparedRules = async (
  databaseTransaction: typeof database,
  prepared: PreparedRules,
  savedRuleId: string,
): Promise<number> => {
  const savedRule = preparedRuleOf(prepared, savedRuleId);

  if (savedRule === undefined) {
    return 0;
  }

  const rowIds = await rowIdsRewrittenBy(databaseTransaction, prepared, savedRule);

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
// category cannot arrive through it. The row follows the new rule (by-hand mark cleared), unless a
// stronger rule of another category still wins it: then the mark is set, so the pick stays and a
// later rewrite of that stronger rule cannot take it back. Returns 1 when the category changed,
// because the rewrite skips a row that already holds the picked category and would not count it.
const giveSourceRowCategory = async (
  databaseTransaction: typeof database,
  prepared: PreparedRules,
  sourceTransactionId: string,
  savedRule: { id: string; category: string },
): Promise<number> => {
  const [source] = await databaseTransaction
    .select({
      category: transactions.category,
      description: transactions.description,
      amountMinorUnits: transactions.amountMinorUnits,
      time: transactions.time,
      currency: holdings.currency,
    })
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(eq(transactions.id, sourceTransactionId));

  if (source === undefined) {
    return 0;
  }

  const winner = winningRule(prepared, subjectOfStoredRow(source));
  const isOutRanked =
    winner !== undefined &&
    winner.id !== savedRule.id &&
    !isSameCategory(winner.category, savedRule.category);

  await databaseTransaction
    .update(transactions)
    .set({ category: savedRule.category, categorySetByHand: isOutRanked })
    .where(eq(transactions.id, sourceTransactionId));

  return isSameCategory(source.category, savedRule.category) ? 0 : 1;
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
   * How many rows saving this rule with "Apply to existing" would change, judged over every rule
   * with the draft in place of its stored self (or added, for a new rule) and ranked as the newest
   * of its strength. Reads only. A rule that is saved again as it is stored changes nothing, so
   * it counts none.
   */
  countRuleRewrite: async (draft: RuleDraft): Promise<number> => {
    const { stored, row, prepared } = stageDraft(
      await readAllRulesDatabaseTransaction(database),
      draft,
    );

    if (isStoredAsGiven(stored, draft)) {
      return 0;
    }

    const savedRule = preparedRuleOf(prepared, row.id);

    return savedRule === undefined
      ? 0
      : (await rowIdsRewrittenBy(database, prepared, savedRule)).length;
  },
  /**
   * Saves the rule and, when asked, rewrites every existing row it wins, all in ONE write, so the
   * rule and the ledger cannot disagree and the rewrite is planned on the rows as they stand
   * inside the write. A rule that fails the editor's validation, or could not be read back, is
   * refused by throwing before anything is written, so a bad rule never lands whatever the
   * caller did. A rule saved as it is stored writes nothing. `changed` is the number of rows whose
   * category moved.
   */
  saveRule: (input: RuleDraft & { applyToExisting: boolean }) =>
    write(async (databaseTransaction): Promise<{ id: string; changed: number }> => {
      const rows = await readAllRulesDatabaseTransaction(databaseTransaction);

      assertSavable(refusalOf(input, prepareRules(rows).ordered));

      const { stored, row, prepared } = stageDraft(rows, input);

      if (isStoredAsGiven(stored, input)) {
        return { id: row.id, changed: 0 };
      }

      await storeRule(databaseTransaction, stored, row);

      const changed = input.applyToExisting
        ? await rewriteWithPreparedRules(databaseTransaction, prepared, row.id)
        : 0;

      return { id: row.id, changed };
    }),
  /**
   * Makes `name` -> `category` a rule and rewrites every existing row that rule wins, all in ONE
   * write so a partial failure can never leave the rule and the ledger disagreeing. A rule that
   * is already exactly this name moves to the new category (it keeps its id and is now the newest
   * rule, so the user's latest choice wins a tie); a rule with other conditions beside this name
   * is a different rule and is left alone. The row the user is editing gets the picked category
   * and is freed from its by-hand mark, because it now follows the rule, unless a stronger rule of
   * another category wins that row: then it is flagged by hand instead, so the pick stays. A blank
   * name is a no-op: it must not become a catch-all.
   *
   * Categories are keyed by a stable slug, so a later category rename only changes its title.
   */
  applyNameRule: (input: { name: string; category: string; sourceTransactionId: string | null }) =>
    write(async (databaseTransaction) => {
      if (normalizeTransactionName(input.name) === '') {
        return 0;
      }

      const matchers: CategoryRuleMatcher[] = [{ type: 'nameIs', text: input.name.trim() }];
      const rows = await readAllRulesDatabaseTransaction(databaseTransaction);
      const wantedKey = matcherSetKey(matchers);
      const existingRule = prepareRules(rows).ordered.find(
        (rule) => matcherSetKey(rule.matchers) === wantedKey,
      );
      const { stored, row, prepared } = stageDraft(rows, {
        id: existingRule?.id ?? null,
        category: input.category,
        matchers,
      });

      await storeRule(databaseTransaction, stored, row);

      const sourceMoved =
        input.sourceTransactionId === null
          ? 0
          : await giveSourceRowCategory(databaseTransaction, prepared, input.sourceTransactionId, {
              id: row.id,
              category: input.category,
            });

      return sourceMoved + (await rewriteWithPreparedRules(databaseTransaction, prepared, row.id));
    }),
} satisfies Repository;
