import {
  id as newId,
  chunkRows,
  database,
  type Repository,
  type TransactionTemplateRow,
  transactionTemplates,
  write,
} from '@kiko/db';
import {
  EMPTY_DRAFT,
  type TemplateDraft,
  clearDraftReferences,
  draftReferences,
  isTemplateDraft,
} from '@kiko/transaction-templates/draft';
import { asc, eq, or, sql } from 'drizzle-orm';
import { isTemplateNameTaken } from '@kiko/transaction-templates/template-name';

import { TemplateNameTakenError } from './template-name-taken-error';

export type TransactionTemplate = {
  id: string;
  name: string;
  draft: TemplateDraft;
  createdAt: number;
  updatedAt: number;
};

type TemplateInput = { name: string; draft: TemplateDraft };

// The column is typed unknown (src/db must not import a feature), so this is where a stored
// draft is narrowed. A row from another build, or a restored file, reads as an empty draft
// with its name kept, so the user can still open, fix or delete it.
export const toTransactionTemplate = (row: TransactionTemplateRow): TransactionTemplate => ({
  id: row.id,
  name: row.name,
  draft: isTemplateDraft(row.draft) ? row.draft : EMPTY_DRAFT,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// The name rule runs in JS: SQLite's lower() folds ASCII only, so "Оренда" and "оренда" would
// both pass a SQL check. The read is the two columns the rule needs, never the whole row.
const assertNameFree = async (
  databaseTransaction: typeof database,
  name: string,
  exceptId: string | null,
): Promise<void> => {
  const existing = await databaseTransaction
    .selectDistinct({ id: transactionTemplates.id, name: transactionTemplates.name })
    .from(transactionTemplates);

  if (isTemplateNameTaken(name, existing, exceptId)) {
    throw new TemplateNameTakenError();
  }
};

// SQLite parses `a or b or ...` as a left-deep tree and refuses one deeper than 1000, a limit
// reached long before the bound-parameter one (about 32000 here).
const MAX_OR_TERMS = 500;

// The prefilter can match more rows than really reference an id (a description may hold the
// same text); the caller decides exactly with `draftReferences`. The needle is the exact JSON
// encoding of the id, so a key that JSON escapes still matches its stored form.
const prefilteredRows = async (
  databaseTransaction: typeof database,
  needleSources: readonly string[],
): Promise<{ id: string; draft: unknown }[]> => {
  const rowsById = new Map<string, { id: string; draft: unknown }>();

  for (const chunk of chunkRows([...needleSources], MAX_OR_TERMS)) {
    const rows = await databaseTransaction
      .select({ id: transactionTemplates.id, draft: transactionTemplates.draft })
      .from(transactionTemplates)
      .where(
        or(
          ...chunk.map(
            (source) => sql`instr(${transactionTemplates.draft}, ${JSON.stringify(source)}) > 0`,
          ),
        ),
      );

    for (const row of rows) {
      rowsById.set(row.id, row);
    }
  }

  return [...rowsById.values()];
};

type ReferencingTemplate = { id: string; draft: TemplateDraft };

const referencingTemplates = async (
  databaseTransaction: typeof database,
  needleSources: readonly string[],
  references: (draft: TemplateDraft) => boolean,
): Promise<ReferencingTemplate[]> => {
  const rows = await prefilteredRows(databaseTransaction, needleSources);

  return rows.flatMap((row) =>
    isTemplateDraft(row.draft) && references(row.draft) ? [{ id: row.id, draft: row.draft }] : [],
  );
};

const holdingReferences =
  (holdingIds: readonly string[]) =>
  (draft: TemplateDraft): boolean =>
    draftReferences(draft).holdingIds.some((holdingId) => holdingIds.includes(holdingId));

const categoryReferences =
  (key: string) =>
  (draft: TemplateDraft): boolean =>
    draftReferences(draft).categoryKey === key;

// Only `draft` is set: a clear is the app's own cleanup, not an edit by the user, so
// `updated_at` stays as it was.
const rewriteDrafts = async (
  databaseTransaction: typeof database,
  templates: readonly ReferencingTemplate[],
  cleared: { holdingIds: readonly string[]; categoryKey: string | null },
): Promise<void> => {
  for (const template of templates) {
    await databaseTransaction
      .update(transactionTemplates)
      .set({ draft: clearDraftReferences(template.draft, cleared) })
      .where(eq(transactionTemplates.id, template.id));
  }
};

export const transactionTemplatesRepo = {
  listQuery: () =>
    database
      .select()
      .from(transactionTemplates)
      .orderBy(asc(transactionTemplates.createdAt), asc(transactionTemplates.id)),
  create: (input: TemplateInput): Promise<string> =>
    write((databaseTransaction) =>
      transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, input),
    ),
  update: (input: { id: string } & TemplateInput): Promise<void> =>
    write(async (databaseTransaction) => {
      await assertNameFree(databaseTransaction, input.name, input.id);
      await databaseTransaction
        .update(transactionTemplates)
        .set({ name: input.name.trim(), draft: input.draft, updatedAt: Date.now() })
        .where(eq(transactionTemplates.id, input.id));
    }),
  remove: (id: string): Promise<void> =>
    write(async (databaseTransaction) => {
      await databaseTransaction.delete(transactionTemplates).where(eq(transactionTemplates.id, id));
    }),
  // Runs inside the caller's own `write()`, so a transaction and its template are saved, or
  // rolled back, together.
  insertDatabaseTransaction: async (
    databaseTransaction: typeof database,
    input: TemplateInput,
  ): Promise<string> => {
    await assertNameFree(databaseTransaction, input.name, null);

    const templateId = newId();

    await databaseTransaction
      .insert(transactionTemplates)
      .values({ id: templateId, name: input.name.trim(), draft: input.draft });

    return templateId;
  },
  clearHoldingsDatabaseTransaction: async (
    databaseTransaction: typeof database,
    holdingIds: readonly string[],
  ): Promise<void> => {
    const templates = await referencingTemplates(
      databaseTransaction,
      holdingIds,
      holdingReferences(holdingIds),
    );

    await rewriteDrafts(databaseTransaction, templates, { holdingIds, categoryKey: null });
  },
  clearCategoryDatabaseTransaction: async (
    databaseTransaction: typeof database,
    key: string,
  ): Promise<void> => {
    const categoryKey = key.toLowerCase();
    const templates = await referencingTemplates(
      databaseTransaction,
      [categoryKey],
      categoryReferences(categoryKey),
    );

    await rewriteDrafts(databaseTransaction, templates, { holdingIds: [], categoryKey });
  },
  countReferencingHoldingsDatabaseTransaction: async (
    databaseTransaction: typeof database,
    holdingIds: readonly string[],
  ): Promise<number> =>
    (await referencingTemplates(databaseTransaction, holdingIds, holdingReferences(holdingIds)))
      .length,
  countReferencingCategory: async (key: string): Promise<number> => {
    const categoryKey = key.toLowerCase();

    return (await referencingTemplates(database, [categoryKey], categoryReferences(categoryKey)))
      .length;
  },
} satisfies Repository;
