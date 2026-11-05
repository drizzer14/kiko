import type { ReviewGroup } from '@kiko/categories/category-rules';

export type ReviewLineProps = {
  group: ReviewGroup;
  // A pick is being previewed or written: another one would be dropped without a word.
  disabled: boolean;
  onChoose: (group: ReviewGroup) => void;
};
