// Formats a numeric amount string with grouped thousands AS THE USER TYPES,
// e.g. "1000000" -> "1 000 000". A space is the grouping separator (the iOS
// convention for UAH; see currency/format.ts), and the decimal separator the
// decimal-pad emits (',' or '.') is preserved exactly so a half-typed decimal
// stays editable. The inverse is `parseAmount` (currency/parse.ts), which
// strips the grouping spaces back out — the two round-trip.
//
// Robustness over partial input: a lone "0", a trailing separator ("12,"), a
// leading-zero run ("007"), and a lone separator (",") are all preserved rather
// than reformatted, so typing never drops a character or reshuffles digits.

// Inserts a grouping space every three digits from the right. A run of pure
// digits (no separators) — the integer part — is all this needs to handle.
const groupDigits = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const groupAmount = (input: string): string => {
  // Drop any existing grouping whitespace first, so re-formatting an already-
  // grouped value ("1 0000" after a keystroke) re-groups from the raw digits.
  const compact = input.replace(/\s/g, '');
  // Preserve a single leading minus so a negative amount still round-trips
  // through parseAmount (the account-value clamp relies on the sign surviving);
  // the decimal-pad never emits one, but a pasted/hydrated value can carry it.
  const sign = compact.startsWith('-') ? '-' : '';
  const body = compact.slice(sign.length);
  const separator = body.match(/[.,]/);

  if (separator === null) {
    return sign.concat(groupDigits(body.replace(/\D/g, '')));
  }

  const decimalMark = separator[0];
  const decimalIndex = body.indexOf(decimalMark);
  const integerDigits = body.slice(0, decimalIndex).replace(/\D/g, '');
  const fractionDigits = body.slice(decimalIndex + 1).replace(/\D/g, '');

  return sign.concat(groupDigits(integerDigits), decimalMark, fractionDigits);
};
