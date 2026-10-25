export type TemplateSelectProps = {
  // Every stored template, in the order the list shows them. `createdAt` (ms) lets the "Add
  // template" round trip pick only a template stamped inside its own window.
  templates: readonly { id: string; name: string; createdAt: number }[];
  // The read of those templates has not settled: an empty list then says nothing yet, so the
  // empty-list hint and the "Add template" row wait for it.
  isLoading: boolean;
  // The picked template's id, or `null` while nothing is picked.
  selectedId: string | null;
  onSelect: (templateId: string) => void;
  // Opens the new-template form, from the empty sheet's "Add template" row. The select then picks
  // the template that form saves, through `onSelect`.
  onCreateTemplate: () => void;
};
