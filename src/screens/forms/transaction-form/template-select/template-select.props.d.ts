export type TemplateSelectProps = {
  // Every stored template, in the order the list shows them.
  templates: readonly { id: string; name: string }[];
  // The picked template's id, or `null` while nothing is picked.
  selectedId: string | null;
  onSelect: (templateId: string) => void;
};
