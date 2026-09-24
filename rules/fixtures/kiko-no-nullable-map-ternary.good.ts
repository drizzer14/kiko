import maybe, { foldMap } from 'fnts/maybe';

const label = foldMap(maybe(holding.nickname), (nickname) => nickname.trim());

const tags = foldMap(maybe(holding.category), (category) => [toTag(category)]) ?? [];

// Default-value ternary: the fallback is a real value, not null/undefined/[].
const fallbackLabel = value !== null ? format(value) : 'fallback';

// Validator-error ternary: the real message is on the ABSENT side, `undefined`
// on the present side — the opposite polarity from a nullable map.
const error = value === null ? 'required' : undefined;

const choice = cond ? 'a' : 'b';

const emptyStringFallback = value === undefined ? '' : String(value);
