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

export const choice = (cond: boolean): string => (cond ? 'a' : 'b');

export const emptyStringFallback = (value: string | undefined): string =>
  value === undefined ? '' : String(value);
