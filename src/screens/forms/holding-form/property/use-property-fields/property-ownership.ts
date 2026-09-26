import {
  sameShare,
  sharePercentText,
  parsePercentShare,
  parseFractionShare,
  type OwnershipChange,
  type OwnershipShare,
} from '@kiko/holdings/ownership';
import { match } from 'ts-pattern';
import type { OwnershipInput, PropertyMeta } from '@kiko/holdings/holding-metadata';

/** The share as typed: one percent field, or a numerator and a denominator. */
export type OwnershipEntry = {
  mode: OwnershipInput;
  percent: string;
  numerator: string;
  denominator: string;
};

// Both input forms are filled, so switching the mode never shows an empty field.
export const ownershipEntryOf = (mode: OwnershipInput, share: OwnershipShare): OwnershipEntry => ({
  mode,
  percent: sharePercentText(share),
  numerator: String(share.numerator),
  denominator: String(share.denominator),
});

// A percent only holds two decimals, so 1/3 pre-fills as "33.33"; a percent
// that shows the same as the share in effect is that share, or re-saving an
// untouched form would record 3333/10000 as a change.
const enteredPercentShare = (percent: string, current: OwnershipShare): OwnershipShare | null => {
  const parsed = parsePercentShare(percent);

  if (parsed === null) {
    return null;
  }

  return sharePercentText(parsed) === sharePercentText(current) ? current : parsed;
};

/** The typed share, or null when it does not parse. */
export const enteredShare = (
  entry: OwnershipEntry,
  current: OwnershipShare,
): OwnershipShare | null =>
  match(entry.mode)
    .with('percent', () => enteredPercentShare(entry.percent, current))
    .with('fraction', () => parseFractionShare(entry.numerator, entry.denominator))
    .exhaustive();

/** Whether the typed share is a change from the one in effect. */
export const shareChanged = (entered: OwnershipShare | null, current: OwnershipShare): boolean =>
  entered !== null && !sameShare(entered, current);

/** The ownership keys to save; none for an empty list, which reads the whole asset. */
export const ownershipMetadata = (
  changes: readonly OwnershipChange[],
  mode: OwnershipInput,
): Pick<PropertyMeta, 'ownership' | 'ownershipInput'> =>
  changes.length === 0 ? {} : { ownership: [...changes], ownershipInput: mode };
