// A category key is compared the way the category page, the delete and the display resolve it:
// without case. A row or a rule restored from an older file can still carry a capitalized key.
export const categoryKeyOf = (category: string): string => category.toLowerCase();

export const isSameCategory = (stored: string | null, asked: string): boolean =>
  stored !== null && categoryKeyOf(stored) === categoryKeyOf(asked);
