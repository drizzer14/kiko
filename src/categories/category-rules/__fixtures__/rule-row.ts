import type { CategoryRuleMatcher, StoredCategoryRule } from '../category-rules.d';

export const ruleRow = ({
  id = 'rule-1',
  category = 'food',
  matchers,
  createdAt = 1,
  updatedAt = 1,
}: {
  id?: string;
  category?: string;
  matchers: readonly CategoryRuleMatcher[];
  createdAt?: number;
  updatedAt?: number;
}): StoredCategoryRule => ({
  id,
  category,
  matchers: JSON.stringify(matchers),
  createdAt,
  updatedAt,
});
