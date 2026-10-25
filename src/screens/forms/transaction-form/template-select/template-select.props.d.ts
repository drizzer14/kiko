import type { HandbackId } from '@kiko/screens/forms/use-select-created-option';

export type TemplateSelectProps = {
  // Every stored template, in the order the list shows them.
  templates: readonly { id: string; name: string }[];
  // The read of those templates has not settled: an empty list then says nothing yet, so the
  // empty-list hint and the "Add template" row wait for it.
  isLoading: boolean;
  // The picked template's id, or `null` while nothing is picked.
  selectedId: string | null;
  onSelect: (templateId: string) => void;
  // Opens the new-template form with the handback id its save hands the template to, from the empty
  // sheet's "Add template" row. The select then picks exactly that template, through `onSelect`.
  onCreateTemplate: (handbackId: HandbackId) => void;
};
