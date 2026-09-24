import maybe, { foldMap } from 'fnts/maybe';

type Holding = { nickname: string; category: string | null };

const toTag = (category: string): string => category;
const format = (value: string): string => value;

export const nicknameLabel = (holding: Holding): string | undefined =>
  foldMap(maybe(holding.nickname), (nickname) => nickname.trim());

export const categoryTags = (holding: Holding): string[] =>
  foldMap(maybe(holding.category), (category) => [toTag(category)]) ?? [];

// Default-value ternary: the fallback is a real value, not null/undefined/[].
export const fallbackLabel = (value: string | null): string =>
  value !== null ? format(value) : 'fallback';

// Validator-error ternary: the real message is on the ABSENT side, `undefined`
// on the present side — the opposite polarity from a nullable map.
export const requiredError = (value: string | null): string | undefined =>
  value === null ? 'required' : undefined;

export const choice = (condition: boolean): string => (condition ? 'a' : 'b');

export const emptyStringFallback = (value: string | undefined): string =>
  value === undefined ? '' : String(value);

// Presence ternary: the present-side branch is a constant that never
// references $X — not a MAP of $X's value, so this must NOT match (the real
// shapes at bottom-sheet.component.tsx's accessibilityRole and
// transactions.repo.ts's loanLinkSource, forced through the rule and
// reverted once the metavariable-pattern constraint below caught them).
export const roleFor = (label: string | undefined): string | undefined =>
  label === undefined ? undefined : 'button';

export const linkSourceFor = (loanHoldingId: string | null): string | null =>
  loanHoldingId === null ? null : 'manual';
