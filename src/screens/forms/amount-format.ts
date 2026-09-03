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
  // Pick the decimal mark by the LAST-occurring separator, exactly as parseAmount
  // does. A value carrying BOTH a grouping and a decimal separator (a pasted or
  // hydrated European "1.234,56") would otherwise be mangled by treating the
  // first separator as the decimal; the other separator is grouping and is
  // stripped from the integer part here so the two stay in lock-step.
  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) {
    return sign.concat(groupDigits(body.replace(/\D/g, '')));
  }

  const decimalIndex = Math.max(lastComma, lastDot);
  const decimalMark = body[decimalIndex];
  const integerDigits = body.slice(0, decimalIndex).replace(/\D/g, '');
  const fractionDigits = body.slice(decimalIndex + 1).replace(/\D/g, '');

  return sign.concat(groupDigits(integerDigits), decimalMark, fractionDigits);
};
