import { type Currency, currencyScale } from '../currency';

// Prices, quantities, and purity are scaled decimal STRINGS (kiko-domain's
// money precision rule): a JS `number` loses precision on an arbitrary-length
// decimal, so every arithmetic step here goes through `bigint`, never
// through float math.

/** A signed decimal split into its `bigint` digit magnitude and decimal scale. */
type SignedDecimal = { signedDigits: bigint; scale: number };

const parseSignedDecimal = (value: string): SignedDecimal => {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const digitsText = `${intPart}${fracPart}`;
  const magnitude = digitsText === '' ? 0n : BigInt(digitsText);

  return { signedDigits: negative ? -magnitude : magnitude, scale: fracPart.length };
};

/** Renders a signed `bigint`/scale pair back to a decimal string. */
const formatSignedDecimal = (value: bigint, scale: number): string => {
  const negative = value < 0n;
  const absoluteValue = negative ? -value : value;
  const digits = absoluteValue.toString().padStart(scale + 1, '0');
  const intPart = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const fracPart = scale === 0 ? '' : digits.slice(digits.length - scale);
  const body = fracPart === '' ? intPart : `${intPart}.${fracPart}`;

  return negative && value !== 0n ? `-${body}` : body;
};

/** Aligns two signed decimals to their wider common scale for +/-/compare. */
const alignScale = (a: SignedDecimal, b: SignedDecimal): [bigint, bigint, number] => {
  const scale = Math.max(a.scale, b.scale);
  const scaledA = a.signedDigits * 10n ** BigInt(scale - a.scale);
  const scaledB = b.signedDigits * 10n ** BigInt(scale - b.scale);

  return [scaledA, scaledB, scale];
};

// Only a trimmed, dot-or-comma, unsigned, non-exponent decimal string passes —
// e.g. a user-typed price/quantity/purity field. "1e5" and "-1.5" are
// rejected on purpose: exponent form and a sign are both handled elsewhere
// (decimalFromJsonNumber, addDecimal/subDecimal), never through this
// user-input gate.
const PLAIN_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Normalizes a user-typed amount/quantity/purity string to a plain decimal
 * string: trims, swaps a comma decimal mark for a dot, and strips interior
 * grouping whitespace (including a non-breaking space). Returns null for
 * anything that is not a plain unsigned decimal afterward — junk, exponent
 * notation, or an explicit sign.
 */
export const normalizeDecimal = (input: string): string | null => {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');

  return PLAIN_DECIMAL_PATTERN.test(normalized) ? normalized : null;
};

/** Adds two decimal strings exactly, at the wider operand's scale. Signed result allowed. */
export const addDecimal = (a: string, b: string): string => {
  const [scaledA, scaledB, scale] = alignScale(parseSignedDecimal(a), parseSignedDecimal(b));

  return formatSignedDecimal(scaledA + scaledB, scale);
};

/** Subtracts two decimal strings exactly, at the wider operand's scale. Signed result allowed. */
export const subDecimal = (a: string, b: string): string => {
  const [scaledA, scaledB, scale] = alignScale(parseSignedDecimal(a), parseSignedDecimal(b));

  return formatSignedDecimal(scaledA - scaledB, scale);
};

/** Compares two decimal strings exactly, regardless of their stored scale. */
export const compareDecimal = (a: string, b: string): -1 | 0 | 1 => {
  const [scaledA, scaledB] = alignScale(parseSignedDecimal(a), parseSignedDecimal(b));

  if (scaledA < scaledB) {
    return -1;
  }

  if (scaledA > scaledB) {
    return 1;
  }

  return 0;
};

/**
 * Shifts a decimal string's point by `places`: negative divides (moves the
 * point left), positive multiplies (moves it right) — e.g.
 * `shiftDecimal('12345', -2)` -> `'123.45'`. Exact, via `bigint`.
 */
export const shiftDecimal = (value: string, places: number): string => {
  const parsed = parseSignedDecimal(value);
  const newScale = parsed.scale - places;

  if (newScale >= 0) {
    return formatSignedDecimal(parsed.signedDigits, newScale);
  }

  return formatSignedDecimal(parsed.signedDigits * 10n ** BigInt(-newScale), 0);
};

// A JS `number` parsed from JSON can print in exponential notation
// (`(1e-7).toString() === '1e-7'`) — this expands that mantissa/exponent form
// back to a plain decimal string via `shiftDecimal`, so the result is exact
// (no float re-parse) rather than a `toFixed`-style approximation.
const EXPONENTIAL_PATTERN = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/i;

/**
 * Converts an API-provided JSON number (a price, rate, or quantity) to a
 * plain decimal string, expanding exponent notation exactly. This is the
 * single boundary conversion for a JSON number -> decimal string (kiko-
 * domain: "API JSON numbers are converted once, at the boundary"). Returns
 * null for a non-finite value (NaN, +/-Infinity).
 */
export const decimalFromJsonNumber = (value: number): string | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value === 0) {
    return '0';
  }

  const negative = value < 0;
  const absoluteText = Math.abs(value).toString();
  const match = absoluteText.match(EXPONENTIAL_PATTERN);

  if (!match) {
    return negative ? `-${absoluteText}` : absoluteText;
  }

  const [, intPart, fracPart = '', exponentText] = match;
  const exponent = Number(exponentText) - fracPart.length;
  const expanded = shiftDecimal(`${intPart}${fracPart}`, exponent);

  return negative ? `-${expanded}` : expanded;
};

const roundHalfAwayFromZero = (numerator: bigint, denominator: bigint): bigint => {
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const roundedUp = remainder * 2n >= absoluteDenominator;

  return sign * (roundedUp ? quotient + 1n : quotient);
};

/**
 * Multiplies a chain of decimal-string factors (a quantity, a price, a
 * cross-rate) — optionally dividing by one more decimal-string factor — and
 * rounds the exact result to `currency`'s minor-unit scale, half away from
 * zero. The one BigInt boundary every price/quantity/purity multiplication
 * in the app goes through (kiko-domain), so a share valuation or a metal
 * weight never drifts through float math.
 */
export const multiplyToMinorUnits = (
  factors: readonly string[],
  currency: Currency,
  divideBy?: string,
): number => {
  const targetScale = currencyScale[currency];

  let numeratorDigits = 1n;
  let numeratorScale = 0;

  for (const factor of factors) {
    const parsed = parseSignedDecimal(factor);
    numeratorDigits *= parsed.signedDigits;
    numeratorScale += parsed.scale;
  }

  const denominator =
    divideBy === undefined ? { signedDigits: 1n, scale: 0 } : parseSignedDecimal(divideBy);

  const scaledNumerator = numeratorDigits * 10n ** BigInt(denominator.scale + targetScale);
  const scaledDenominator = denominator.signedDigits * 10n ** BigInt(numeratorScale);

  return Number(roundHalfAwayFromZero(scaledNumerator, scaledDenominator));
};
