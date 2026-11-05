import type { ReviewGroup } from '@kiko/categories/category-rules';

export type ReviewLineProps = {
  group: ReviewGroup;
  onChoose: (group: ReviewGroup) => void;
};
