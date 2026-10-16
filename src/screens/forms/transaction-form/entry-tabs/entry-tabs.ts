import maybe, { foldMap } from 'fnts/maybe';
import type { TransactionTemplateRow } from '@kiko/db';

export type EntryTab = 'manual' | 'template';

export const ENTRY_TABS: readonly EntryTab[] = ['manual', 'template'];

// Whether the form is held back until a template is picked: the Template tab of an entry that has
// the tabs, with nothing picked yet. A template the route names is not "nothing picked" while its
// read is still loading, so the form does not flash away and back. Kept pure so the footer and the
// tabs share one answer.
export const awaitsTemplatePick = (args: {
  hasEntryTabs: boolean;
  tab: EntryTab;
  selectedTemplateId: string | null;
  isEntryTemplateLoading: boolean;
}): boolean =>
  args.hasEntryTabs &&
  args.tab === 'template' &&
  args.selectedTemplateId === null &&
  !args.isEntryTemplateLoading;

// The template the Template tab has picked: the one picked from the select, else the one the route
// names. A picked id that the list does not hold (deleted since) falls back to the route's one.
export const resolveSelectedTemplate = (args: {
  pickedId: string | null;
  templates: readonly TransactionTemplateRow[];
  entryTemplate: TransactionTemplateRow | undefined;
}): { template: TransactionTemplateRow | undefined; id: string | null } => {
  const template =
    args.templates.find((candidate) => candidate.id === args.pickedId) ?? args.entryTemplate;

  return { template, id: foldMap(maybe(template), (found) => found.id) ?? null };
};
