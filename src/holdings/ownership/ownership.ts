import {
  trimDecimal,
  shiftDecimal,
  scaleMinorUnits,
  normalizeDecimal,
} from '@kiko/currency/decimal';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { dayKeyOf } from '@kiko/prices/price-book';

import type { PropertyMeta, OwnershipInput, PropertyCategory } from '../holding-metadata';

/** A reduced fraction of a whole asset, `0 < numerator <= denominator`. */
export type OwnershipShare = { numerator: number; denominator: number };

/**
 * The share owned from `day` — a `dayKeyOf` key, the same local-day
 * convention a lot carries — until the next change.
 */
export type OwnershipChange = OwnershipShare & { day: number };

export const WHOLE_SHARE: OwnershipShare = { numerator: 1, denominator: 1 };

// A percent is entered with at most two decimals, so every percent share is
// an exact count of hundredths of a percent out of 10000.
const PERCENT_DECIMALS = 2;
const WHOLE_IN_HUNDREDTHS_OF_PERCENT = 10_000;

const INTEGER_PATTERN = /^\d+$/;

const greatestCommonDivisor = (first: number, second: number): number =>
  second === 0 ? first : greatestCommonDivisor(second, first % second);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isReducedShare = (numerator: number, denominator: number): boolean =>
  numerator <= denominator && greatestCommonDivisor(numerator, denominator) === 1;

export const sameShare = (first: OwnershipShare, second: OwnershipShare): boolean =>
  first.numerator === second.numerator && first.denominator === second.denominator;

const shareOf = ({ numerator, denominator }: OwnershipShare): OwnershipShare => ({
  numerator,
  denominator,
});

export const reduceShare = (numerator: number, denominator: number): OwnershipShare => {
  const divisor = greatestCommonDivisor(numerator, denominator);

  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

const asOwnershipChange = (value: unknown): OwnershipChange | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { day, numerator, denominator } = value as Record<string, unknown>;

  if (
    typeof day !== 'number' ||
    !isPositiveInteger(numerator) ||
    !isPositiveInteger(denominator) ||
    !isReducedShare(numerator, denominator)
  ) {
    return null;
  }

  return { day, numerator, denominator };
};

/**
 * Parses a stored `metadata.ownership` list. All-or-nothing, like `asLots`:
 * one invalid entry, an out-of-order day, or a repeated day rejects the list.
 */
export const asOwnershipChanges = (value: unknown): OwnershipChange[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed = value.map(asOwnershipChange);

  if (!parsed.every((change): change is OwnershipChange => change !== null)) {
    return null;
  }

  const ascending = parsed.every(
    (change, index) => index === 0 || parsed[index - 1].day < change.day,
  );

  return ascending ? parsed : null;
};

/**
 * A typed percent (`"50"`, `"33,33"`) as a share; null outside `0 < p <= 100` or past 2
 * decimals.
 */
export const parsePercentShare = (input: string): OwnershipShare | null => {
  const normalized = normalizeDecimal(input);

  if (normalized === null) {
    return null;
  }

  const [, decimals = ''] = normalized.split('.');

  if (decimals.length > PERCENT_DECIMALS) {
    return null;
  }

  const hundredths = Number(shiftDecimal(normalized, PERCENT_DECIMALS));

  if (hundredths <= 0 || hundredths > WHOLE_IN_HUNDREDTHS_OF_PERCENT) {
    return null;
  }

  return reduceShare(hundredths, WHOLE_IN_HUNDREDTHS_OF_PERCENT);
};

const parsePositiveInteger = (input: string): number | null => {
  const trimmed = input.trim();

  if (!INTEGER_PATTERN.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);

  return isPositiveInteger(value) ? value : null;
};

/** Two typed whole numbers (`"1"`, `"3"`) as a share; null unless `0 < n <= d`. */
export const parseFractionShare = (
  numeratorInput: string,
  denominatorInput: string,
): OwnershipShare | null => {
  const numerator = parsePositiveInteger(numeratorInput);
  const denominator = parsePositiveInteger(denominatorInput);

  if (numerator === null || denominator === null || numerator > denominator) {
    return null;
  }

  return reduceShare(numerator, denominator);
};

/**
 * The change in effect on `instant`'s local day: the latest one on or before
 * it. Undefined before the first change, and with no changes. Unlike
 * `priceAt`, the first change never carries back: an edit that halves a
 * property owned whole since 2020 must not halve its history before the
 * effective day. A share set at creation sits on the lot day, and the value
 * is zero before that day, so it still reads everywhere the holding has value.
 */
export const ownershipChangeAt = (
  changes: readonly OwnershipChange[],
  instant: number,
): OwnershipChange | undefined => {
  const day = dayKeyOf(instant);
  const atOrBefore = changes.filter((change) => change.day <= day);

  return atOrBefore.at(-1);
};

/**
 * The share owned on `instant`'s local day; before the first change, and with none, the whole
 * asset.
 */
export const ownershipAt = (changes: readonly OwnershipChange[], instant: number): OwnershipShare =>
  foldMap(maybe(ownershipChangeAt(changes, instant)), shareOf) ?? WHOLE_SHARE;

/** The owned part of a whole-asset amount, rounded once. */
export const ownedMoney = (whole: Money, share: OwnershipShare): Money =>
  Money.of(whole.currency, scaleMinorUnits(whole.minorUnits, share.numerator, share.denominator));

// Day order with no change that repeats the share before it. A list left
// holding only the whole asset is empty, which reads the same.
const canonicalOwnership = (changes: readonly OwnershipChange[]): OwnershipChange[] => {
  const sorted = [...changes].sort((first, second) => first.day - second.day);
  const withoutRepeats = sorted.filter(
    (current, index) => index === 0 || !sameShare(sorted[index - 1], current),
  );

  return withoutRepeats.every((kept) => sameShare(kept, WHOLE_SHARE)) ? [] : withoutRepeats;
};

const withoutDay = (changes: readonly OwnershipChange[], day: number): OwnershipChange[] =>
  changes.filter((existing) => existing.day !== day);

/** Records `change`: it replaces a change on the same day; the list stays canonical. */
export const withOwnershipChange = (
  changes: readonly OwnershipChange[],
  change: OwnershipChange,
): OwnershipChange[] => canonicalOwnership([...withoutDay(changes, change.day), change]);

/**
 * Replaces the change on `fromDay` with `change`, which may sit on another
 * day. The old change leaves before the list is made canonical again, so a
 * later change that only repeated it is kept until the new one is in place.
 */
export const withEditedOwnershipChange = (
  changes: readonly OwnershipChange[],
  fromDay: number,
  change: OwnershipChange,
): OwnershipChange[] => withOwnershipChange(withoutDay(changes, fromDay), change);

/** Removes the change on `day`; the list stays canonical. */
export const withoutOwnershipChange = (
  changes: readonly OwnershipChange[],
  day: number,
): OwnershipChange[] => canonicalOwnership(withoutDay(changes, day));

/** The ownership keys to save; none for an empty list, which reads the whole asset. */
export const ownershipMetadata = (
  changes: readonly OwnershipChange[],
  input: OwnershipInput,
): Pick<PropertyMeta, 'ownership' | 'ownershipInput'> =>
  changes.length === 0 ? {} : { ownership: [...changes], ownershipInput: input };

// A loan given is a claim the user holds in full; splitting it is not a share
// of an asset.
const ownershipByCategory: Record<PropertyCategory, boolean> = {
  real_estate: true,
  vehicle: true,
  valuable: true,
  loan_given: false,
  business_share: true,
  other: true,
};

export const ownershipApplies = (category: PropertyCategory): boolean =>
  ownershipByCategory[category];

/**
 * The share as a percent with up to two decimals, rounded half away from zero: `"33.33"`,
 * `"50"`.
 */
export const sharePercentText = (share: OwnershipShare): string => {
  const hundredths = scaleMinorUnits(
    WHOLE_IN_HUNDREDTHS_OF_PERCENT,
    share.numerator,
    share.denominator,
  );

  return trimDecimal(shiftDecimal(String(hundredths), -PERCENT_DECIMALS));
};

const percentLabel = (share: OwnershipShare, locale: string): string =>
  `${Number(sharePercentText(share)).toLocaleString(locale)}%`;

/** The share in the form the user typed it: `"50%"` or `"1/3"`, in `locale`'s decimal mark. */
export const ownershipShareText = (
  share: OwnershipShare,
  input: OwnershipInput,
  locale: string,
): string =>
  match(input)
    .with('percent', () => percentLabel(share, locale))
    .with('fraction', () => `${share.numerator}/${share.denominator}`)
    .exhaustive();

/** The typed form, and a fraction's percent after it: `"50%"` or `"1/3 · 33.33%"`. */
export const ownershipShareDetailText = (
  share: OwnershipShare,
  input: OwnershipInput,
  locale: string,
): string =>
  match(input)
    .with('percent', () => percentLabel(share, locale))
    .with(
      'fraction',
      () => `${ownershipShareText(share, input, locale)} · ${percentLabel(share, locale)}`,
    )
    .exhaustive();
