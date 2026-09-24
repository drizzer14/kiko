/**
 * ISIN (ISO 6166) validation — T23. A pure module with no side effects.
 * `normalizeIsin` trims and uppercases a raw candidate; `validateIsin`
 * checks its shape (`^[A-Z]{2}[A-Z0-9]{9}[0-9]$` — a 2-letter country/issuer
 * prefix, 9 more alphanumerics, then a numeric check digit) and its ISO 6166
 * Luhn check digit, returning a discriminated result rather than throwing —
 * the caller decides how to surface a `format` vs a `checkDigit` rejection,
 * the same never-throw-for-an-expected-validation-failure shape the rest of
 * the domain prefers.
 */

const ISIN_FORMAT = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export const normalizeIsin = (raw: string): string => raw.trim().toUpperCase();

// Converts an ISIN's characters to the digit string the ISO 6166 checksum
// operates on: a digit passes through unchanged; a letter becomes its
// alphabet position offset so A=10, B=11, ..., Z=35 (a two-digit value) —
// `charCodeAt(0) - 55` because 'A'.charCodeAt(0) is 65 and 65 - 55 = 10.
const expandToDigits = (isin: string): string =>
  Array.from(isin)
    .map((char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55)))
    .join('');

// The ISO 6166 checksum (a Luhn variant): expand every character to its
// digit form, then double every second digit counting from the RIGHTMOST
// digit (the check digit itself, at index 0 from the right, is never
// doubled), folding a doubled result back to a single digit by subtracting 9
// when it overflows past 9 (equivalent to summing its own two digits, since
// doubling a 0-9 digit never exceeds 18). A valid ISIN's total is a multiple
// of 10.
const isChecksumValid = (isin: string): boolean => {
  const total = Array.from(expandToDigits(isin))
    .reverse()
    .reduce((sum, char, indexFromRight) => {
      const digit = Number(char);
      const doubled = indexFromRight % 2 === 1 ? digit * 2 : digit;

      return sum + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);

  return total % 10 === 0;
};

// Not a separately exported named type (knip flags it unused — nothing
// outside this module consumes the shape by name yet): inlined here as the
// function's own return type instead. A future caller that wires this up to
// a form can pull it back out with `ReturnType<typeof validateIsin>` or
// re-promote it to a named export at that point.
export const validateIsin = (
  raw: string,
): { ok: true; isin: string } | { ok: false; reason: 'format' | 'checkDigit' } => {
  const isin = normalizeIsin(raw);

  if (!ISIN_FORMAT.test(isin)) {
    return { ok: false, reason: 'format' };
  }

  if (!isChecksumValid(isin)) {
    return { ok: false, reason: 'checkDigit' };
  }

  return { ok: true, isin };
};
