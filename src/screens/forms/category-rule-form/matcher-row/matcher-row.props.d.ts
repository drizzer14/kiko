import type { MatcherDraft } from '../rule-draft';

export type MatcherRowProps = {
  draft: MatcherDraft;
  // Zero-based; the labels and test ids count from it.
  position: number;
  // False on the only row left: a rule keeps at least one condition.
  canRemove: boolean;
  onChange: (fields: Partial<MatcherDraft>) => void;
  onRemove: () => void;
  // The error of this row's name or amount field, whichever its type shows.
  error: string | undefined;
};
