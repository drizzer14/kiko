import type { CategoryRuleRow } from '@kiko/db';
import type { RuleValidation } from '@kiko/categories/category-rules';

import type { MatcherDraft, MatcherDraftError } from '../rule-draft';

// A rule the editor may not save, and why.
export type RefusedRule = Exclude<RuleValidation, { kind: 'valid' }>;

// What a refused Save points at, so the screen can bring it into view.
export type RefusalTarget = { kind: 'row'; position: number } | { kind: 'rule' };

export type SubmitControl = { onPress: () => void; isSubmitting: boolean };

export type UseSaveRuleInput = {
  // The stored rule being edited, or null for a new one.
  ruleId: string | null;
  categoryKey: string;
  drafts: readonly MatcherDraft[];
  // Every stored rule: a rule is ranked and checked for a twin against all of them.
  rules: readonly CategoryRuleRow[];
  // The rule is stored; the screen leaves.
  onSaved: () => void;
  onRefused: (target: RefusalTarget) => void;
};

export type UseSaveRuleResult = {
  // Nothing shows before the first Save press, then it follows the drafts.
  errors: { rows: ReadonlyMap<number, MatcherDraftError>; rule: RefusedRule | undefined };
  save: SubmitControl;
  sheet: {
    visible: boolean;
    count: number;
    onDismiss: () => void;
    onClosed: () => void;
    apply: SubmitControl;
    keepNew: SubmitControl;
  };
};
