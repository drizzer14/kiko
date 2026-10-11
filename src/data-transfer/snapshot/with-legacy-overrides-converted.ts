// src/data-transfer/snapshot/with-legacy-overrides-converted.ts
import { id, type CategoryRuleRow } from '@kiko/db';

/** A name rule as a file from before category rules wrote it. A timestamp may be missing. */
export type LegacyCategoryOverrideRow = {
  normalizedName: string;
  category: string;
  displayName: string;
  createdAt?: number;
  updatedAt?: number;
};

/**
 * The restore mirror of the category-rules migration's copy of every override into a rule: one
 * rule per override, with the same category and timestamps, one `nameIs` matcher whose text is
 * the display name, and a fresh id. A blank display name is converted too, into a rule that fails
 * the read-time guard (it is stored, never matches and shows as unreadable), exactly as the
 * migration stores it, so no override of a file is dropped.
 */
export const withLegacyOverridesConverted = (
  rows: readonly LegacyCategoryOverrideRow[],
  now: number,
): CategoryRuleRow[] =>
  rows.map((row) => ({
    id: id(),
    category: row.category,
    matchers: JSON.stringify([{ type: 'nameIs', text: row.displayName }]),
    createdAt: row.createdAt ?? now,
    updatedAt: row.updatedAt ?? now,
  }));
