// A stored JSON value read back as named fields. An array passes `typeof
// 'object'` too, but its keys are indexes, so reading a field off it would
// quietly find nothing instead of failing the parse.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
