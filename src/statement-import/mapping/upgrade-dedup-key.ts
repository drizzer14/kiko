import type { TransactionRow } from '../../db/schema';

import { computeDedupKeyBase, DEDUP_OCCURRENCE_SEPARATOR } from './mapping';

// The literal join `computeDedupKey` used before the `␟` separator existed —
// see `mapping.ts`'s `DEDUP_OCCURRENCE_SEPARATOR` doc comment for the full
// collision this upgrade fixes.
const LEGACY_OCCURRENCE_SEPARATOR = ' ';

type LegacyDedupCandidate = Pick<
  TransactionRow,
  'holdingId' | 'time' | 'amountMinorUnits' | 'description' | 'source' | 'externalId'
>;

/**
 * Recomputes `computeDedupKeyBase` from a STORED row and rewrites an exact
 * pre-`␟` legacy key (`base + ' ' + digits`) to the injective form
 * (`base + '␟' + digits`). Returns `null` — no rewrite — for every other
 * case: an occurrence-0 key (already equals `base`, nothing to change), an
 * edited description or a bank-issued id (the recomputed base no longer
 * matches, so rewriting would be unsafe — the worst case of leaving it alone
 * is a one-time duplicate on re-import, never data loss), and any row that
 * isn't itself a statement-import row.
 *
 * `row.time` is stored in milliseconds (`mapParsedTransaction` writes
 * `transaction.timeSeconds * 1000`); `computeDedupKey` wrote the base from
 * the exact same `timeSeconds` integer, so dividing back by 1000 recovers it
 * losslessly for any row this function was ever meant to match.
 */
export const upgradeLegacyDedupKey = (row: LegacyDedupCandidate): string | null => {
  if (row.source !== 'import' || row.externalId === null) {
    return null;
  }

  const base = computeDedupKeyBase(
    row.holdingId,
    row.time / 1000,
    row.amountMinorUnits,
    row.description,
  );

  if (row.externalId === base) {
    return null;
  }

  const legacyPrefix = `${base}${LEGACY_OCCURRENCE_SEPARATOR}`;

  if (!row.externalId.startsWith(legacyPrefix)) {
    return null;
  }

  const occurrenceDigits = row.externalId.slice(legacyPrefix.length);

  if (!/^\d+$/.test(occurrenceDigits)) {
    return null;
  }

  return `${base}${DEDUP_OCCURRENCE_SEPARATOR}${occurrenceDigits}`;
};
