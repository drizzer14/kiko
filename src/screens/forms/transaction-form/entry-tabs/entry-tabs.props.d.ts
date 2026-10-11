import type { ReactNode } from 'react';

import type { EntryTab } from './entry-tabs';

export type EntryTabsProps = {
  // False on an entry with no tabs (an Edit, a Duplicate, a template mode): only the children show.
  visible: boolean;
  tab: EntryTab;
  onSelectTab: (tab: EntryTab) => void;
  // True while the Template tab waits for a pick: the select shows alone, without the children.
  awaitsPick: boolean;
  templates: readonly { id: string; name: string }[];
  // The read of those templates has not settled yet.
  templatesLoading: boolean;
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string) => void;
  // The form itself, which the tabs sit above and gate.
  children: ReactNode;
};
