import type { CurrencyGroup } from '@kiko/currency/currency-group';

import type { MatcherDraft } from '../rule-draft';

export type MatcherRowProps = {
  draft: MatcherDraft;
  // The currencies an amount condition can name, built once by the screen so every row shares them.
  currencyGroups: readonly CurrencyGroup[];
  // The accounts an account condition can name, labelled by the screen: it knows which are
  // archived and which are implicit, so the row only lists what it is given.
  accounts: readonly { id: string; label: string }[];
  // Zero-based; the labels and test ids count from it.
  position: number;
  // False on the only row left: a rule keeps at least one condition.
  canRemove: boolean;
  onChange: (fields: Partial<MatcherDraft>) => void;
  onRemove: () => void;
  // The error of this row's input, whichever its type shows.
  error: string | undefined;
};
