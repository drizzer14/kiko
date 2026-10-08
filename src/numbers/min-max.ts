// `Math.min(...values)` puts every element on the call stack and throws a
// RangeError on a large array. Folding through `Math.min`/`Math.max` one
// element at a time keeps their exact semantics (NaN, -0, the empty result).
export const minOf = (values: readonly number[]): number =>
  values.reduce((result, value) => Math.min(result, value), Number.POSITIVE_INFINITY);

export const maxOf = (values: readonly number[]): number =>
  values.reduce((result, value) => Math.max(result, value), Number.NEGATIVE_INFINITY);
