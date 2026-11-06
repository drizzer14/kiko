import type { ReviewGroup } from '@kiko/categories/category-rules';

// The category a line's suggestion names, as the options sheet lists it, with the vote it won.
export type ReviewLineSuggestion = {
  key: string;
  // The title as the user sees it: a seeded default's translated name, any other title as stored.
  title: string;
  icon: string;
  agreeing: number;
  total: number;
};

export type ReviewLineProps = {
  group: ReviewGroup;
  // A pick is being previewed or written: another one would be dropped without a word.
  disabled: boolean;
  suggestion: ReviewLineSuggestion | null;
  onChoose: (group: ReviewGroup) => void;
  // The chip was tapped: the same preview and write as a pick of that category.
  onAccept: (group: ReviewGroup, categoryKey: string) => void;
};
