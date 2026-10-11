import either, { bifold, isLeft } from 'fnts/either';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import { TemplateNameTakenError, transactionTemplatesRepo } from '@kiko/transaction-templates/repo';

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
