import type { CurrencyGroup } from '@kiko/currency/currency-group';

import type { MatcherDraft } from '../rule-draft';

export type MatcherRowProps = {
  draft: MatcherDraft;
  // The currencies an amount condition can name, built once by the screen so every row shares them.
  currencyGroups: readonly CurrencyGroup[];
  // Zero-based; the labels and test ids count from it.
  position: number;
  // False on the only row left: a rule keeps at least one condition.
  canRemove: boolean;
  onChange: (fields: Partial<MatcherDraft>) => void;
  onRemove: () => void;
  // The error of this row's name or amount field, whichever its type shows.
  error: string | undefined;
};
