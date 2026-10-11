import either, { bifold, isLeft } from 'fnts/either';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import { TemplateNameTakenError, transactionTemplatesRepo } from '@kiko/transaction-templates/repo';

type DatabaseTransaction = Parameters<typeof transactionTemplatesRepo.insertDatabaseTransaction>[0];

// The extra argument a transaction write takes to save the form's template inside its own write
// (the "save as a new template" switch): empty while the switch is off, so the write is called
// with exactly the arguments it always had. A failure of the insert rejects the whole write, which
// rolls the transaction back with it, so the two are saved together or not at all.
export const alongsideArguments = (input: {
  enabled: boolean;
  name: string;
  draft: TemplateDraft;
}): [] | [(databaseTransaction: DatabaseTransaction) => Promise<void>] =>
  input.enabled
    ? [
        async (databaseTransaction) => {
          await transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, {
            name: input.name,
            draft: input.draft,
          });
        },
      ]
    : [];

// Writes the form's template: a new one, or the one being edited. 'taken' is the write's own
// name check refusing (another template took the name since the form last read the list), which
// the form shows as the name field's error; any other failure is rethrown for the form's shared
// save-error alert.
export const writeTemplate = async (input: {
  editTemplateId: string | null;
  name: string;
  draft: TemplateDraft;
}): Promise<'saved' | 'taken'> => {
  const { editTemplateId, name, draft } = input;
  const result = await either(async () =>
    editTemplateId === null
      ? transactionTemplatesRepo.create({ name, draft })
      : transactionTemplatesRepo.update({ id: editTemplateId, name, draft }),
  );

  if (!isLeft(result)) {
    return 'saved';
  }

  const failure: unknown = bifold(result);

  if (failure instanceof TemplateNameTakenError) {
    return 'taken';
  }

  throw failure;
};
