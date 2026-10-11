import type { TransactionFormParams } from '@kiko/navigation/types';

import type { EntryTab } from '../entry-tabs';

type TemplateEntry = 'add' | 'edit';

// The template mode this entry opens, if any: the form that adds a template or edits one.
// Filling a transaction from a template (`templateId`) is not one: it writes a transaction.
const resolveTemplateEntry = (
  isNewTemplate: boolean,
  editTemplateId: string | null,
): TemplateEntry | null => {
  if (isNewTemplate) {
    return 'add';
  }

  return editTemplateId === null ? null : 'edit';
};

// The mutually-exclusive entry ids read once from the route params, so
// the component body spends no `in`-check branch on any of them (the union
// keeps at most one non-null). `holdingParamId` is the plain-add holding;
// `duplicateOfId` seeds a CREATE pre-filled from an existing manual row;
// `templateId` creates from a template, `editTemplateId` edits one and
// `isNewTemplate` adds one.
export const readRouteEntry = (
  params: TransactionFormParams,
): {
  editingId: string | null;
  duplicateOfId: string | null;
  holdingParamId: string | null;
  templateId: string | null;
  editTemplateId: string | null;
  isNewTemplate: boolean;
  templateEntry: TemplateEntry | null;
  // No holding is fixed by navigation, so the form renders its own primary-leg
  // picker: the global add (B), and every template entry. Derived here, in the
  // same pure read, so the component spends no boolean chain on it.
  isEmptyCreate: boolean;
  // Whether the picker's default holding is seeded on mount: the global add and a
  // new template. A template to fill from or edit seeds its own holding, so a
  // default seated first would close the hydration latch before the template loads.
  seedsDefaultHolding: boolean;
  // The id the by-id template read is keyed on: the template to fill from or to edit, and an empty
  // id for an entry that names none, which reads nothing without a conditional hook.
  templateQueryId: string;
  // What a template with no holding does to the seam: a plain add from a holding
  // keeps that page holding, every other entry clears it so the form asks.
  templateSeat: 'keepPage' | 'clear';
  // Whether the Manual and Template tabs show: on the entries that create a transaction (a global
  // add, an add from a holding, a template to fill from), never on an Edit, a Duplicate or a
  // template mode.
  hasEntryTabs: boolean;
  // The tab the form opens on: a template to fill from opens on Template, with it picked.
  initialTab: EntryTab;
} => {
  const editingId = 'transactionId' in params ? params.transactionId : null;
  const duplicateOfId =
    'duplicateOfTransactionId' in params ? params.duplicateOfTransactionId : null;
  const holdingParamId = 'holdingId' in params ? params.holdingId : null;
  const templateId = 'templateId' in params ? params.templateId : null;
  const editTemplateId = 'editTemplateId' in params ? params.editTemplateId : null;
  const isNewTemplate = 'newTemplate' in params;
  const isEmptyCreate = editingId === null && duplicateOfId === null && holdingParamId === null;

  const templateEntry = resolveTemplateEntry(isNewTemplate, editTemplateId);

  return {
    editingId,
    duplicateOfId,
    holdingParamId,
    templateId,
    editTemplateId,
    isNewTemplate,
    templateEntry,
    isEmptyCreate,
    templateQueryId: templateId ?? editTemplateId ?? '',
    seedsDefaultHolding: isEmptyCreate && templateId === null && editTemplateId === null,
    templateSeat: holdingParamId === null ? 'clear' : 'keepPage',
    hasEntryTabs: editingId === null && duplicateOfId === null && templateEntry === null,
    initialTab: templateId === null ? 'manual' : 'template',
  };
};
