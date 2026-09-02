// Parses a user-entered amount/quantity/rate string into a number, accepting
// BOTH '.' and ',' as the decimal separator. The iOS number pad's decimal key
// is ',' in many locales, so a bare `Number('12,5')` returns NaN (and the
// forms' `Number(x) || 0` then silently reads it as 0). Every numeric form
// input funnels through here instead of `Number(...)` so a comma-typed amount
// parses the same as a dot-typed one. Empty/whitespace/junk yields NaN, which
// callers treat as "no value" (rejecting it, or falling back with `|| 0`).
//
// Grouped input (e.g. "1,234.56") must not be mangled: naively swapping every
// ',' for '.' turns "1,234.56" into "1.234.56" -> NaN. Instead we pick the
// decimal mark by which separator occurs LAST and treat the other separator as
// a thousands grouping character:
//   "1,234.56"  -> dot last  -> comma groups   -> 1234.56
//   "1234,56"   -> comma only -> comma decimal  -> 1234.56
//   "1.234,56"  -> comma last -> dot groups     -> 1234.56 (European form)
//   "12,5"/"12.5"                                -> 12.5
//   junk/lone-separator                          -> NaN
export const parseAmount = (input: string): number => {
  const trimmed = input.trim();

  if (trimmed === '') {
    return Number.NaN;
  }

  const lastComma = trimmed.lastIndexOf(',');
  const lastDot = trimmed.lastIndexOf('.');

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    // No separators at all: a plain integer (or non-numeric junk -> NaN below).
    normalized = trimmed;
  } else if (lastComma > lastDot) {
    // The comma occurs last, so it is the decimal mark; any '.' before it is a
    // thousands grouping separator. Drop the dots, turn the (single) comma into
    // a dot. A stray extra comma leaves a second '.' behind -> NaN, as intended.
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else {
    // The dot occurs last (or there is no comma), so it is the decimal mark;
    // any ',' is a thousands grouping separator to be stripped.
    normalized = trimmed.replace(/,/g, '');
  }

  return Number(normalized);
};
