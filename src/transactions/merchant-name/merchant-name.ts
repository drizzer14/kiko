import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

export type MerchantName = {
  // The grouping identity: a normalized name, or its normalized prefix.
  key: string;
  // The text a "starts with" rule would hold, as written; null when no store number was cut.
  prefix: string | null;
};

export const MERCHANT_PREFIX_MIN_LETTERS = 3;

// One digit is no store number and seven or more is a phone or a reference. A masked card has
// letters or stars in its token, so it never matches.
const STORE_NUMBER = /^[#№]?\d{2,6}$/;
const SEPARATORS_ONLY = /^[#№\-,.]+$/;
const LETTER = /\p{L}/gu;

export const tidiedNameOf = (name: string): string =>
  name.normalize('NFC').replace(/\s+/g, ' ').trim();

const withoutTrailingSeparators = (tokens: readonly string[]): readonly string[] => {
  const last = tokens.at(-1);

  if (last !== undefined && SEPARATORS_ONLY.test(last)) {
    return withoutTrailingSeparators(tokens.slice(0, -1));
  }

  return tokens;
};

const letterCountOf = (text: string): number => (text.match(LETTER) ?? []).length;

// The strip looks at the end only, once: a rule can express only a prefix, and the normalized
// prefix is a prefix of the normalized name, so a `nameStartsWith` on it matches the whole group.
export const merchantNameOf = (name: string): MerchantName => {
  const whole: MerchantName = { key: normalizeTransactionName(name), prefix: null };
  const tokens = tidiedNameOf(name).split(' ');

  if (!STORE_NUMBER.test(tokens.at(-1) ?? '')) {
    return whole;
  }

  const prefix = withoutTrailingSeparators(tokens.slice(0, -1)).join(' ');

  if (letterCountOf(prefix) < MERCHANT_PREFIX_MIN_LETTERS) {
    return whole;
  }

  return { key: normalizeTransactionName(prefix), prefix };
};

export const merchantSpellingOf = (name: string): string =>
  merchantNameOf(name).prefix ?? tidiedNameOf(name);

// Compares by code unit, never by locale: the pick must not depend on row order or on the device.
export const smallestSpelling = (spellings: Iterable<string>): string => {
  const [first, ...rest] = spellings;

  return rest.reduce(
    (smallest, spelling) => (spelling < smallest ? spelling : smallest),
    first ?? '',
  );
};
