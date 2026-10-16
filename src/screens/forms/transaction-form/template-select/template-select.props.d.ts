export type TemplateSelectProps = {
  // Every stored template, in the order the list shows them.
  templates: readonly { id: string; name: string }[];
  // The read of those templates has not settled: an empty list then says nothing yet, so the
  // empty-list hint waits for it.
  isLoading: boolean;
  // The picked template's id, or `null` while nothing is picked.
  selectedId: string | null;
  onSelect: (templateId: string) => void;
};
