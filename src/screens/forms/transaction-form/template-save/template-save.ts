import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import { transactionTemplatesRepo } from '@kiko/transaction-templates/repo';

type DatabaseTransaction = Parameters<typeof transactionTemplatesRepo.insertDatabaseTransaction>[0];

// The optional step a transaction write takes to save the form's template inside its own write
// (the "save as a new template" switch): undefined while the switch is off, which is the write's
// own default. A failure of the insert rejects the whole write, which rolls the transaction back
// with it, so the two are saved together or not at all.
export const alongsideInsert = (input: {
  enabled: boolean;
  name: string;
  draft: TemplateDraft;
}): ((databaseTransaction: DatabaseTransaction) => Promise<void>) | undefined =>
  input.enabled
    ? async (databaseTransaction) => {
        await transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, {
          name: input.name,
          draft: input.draft,
        });
      }
    : undefined;

// Writes the form's template: a new one, or the one being edited. Every failure rejects, for the
// form's shared save-error alert. That includes a name another template took since the form last
// read the list: the inline taken error comes from the live list alone.
export const writeTemplate = async (input: {
  editTemplateId: string | null;
  name: string;
  draft: TemplateDraft;
}): Promise<void> => {
  const { editTemplateId, name, draft } = input;

  if (editTemplateId === null) {
    await transactionTemplatesRepo.create({ name, draft });

    return;
  }

  await transactionTemplatesRepo.update({ id: editTemplateId, name, draft });
};
