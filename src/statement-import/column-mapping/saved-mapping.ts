// A user-confirmed `ColumnMapping`, saved so a re-import of the same bank or
// the same file shape can pre-fill the mapping form instead of asking the
// user to remap every column again (Review Focus 3: a saved mapping only
// PRE-FILLS — the user still taps Import; see `applyColumnMapping`'s caller).
import { isBankId } from '../../bank-sync/bank-catalog';

import type { TableCell } from './table-rows';
import type { ColumnMapping } from './apply-column-mapping';

export type SavedColumnMapping = ColumnMapping & {
  fingerprint: string;
  savedAt: number;
};

// U+241F (SYMBOL FOR UNIT SEPARATOR) joins the header row's trimmed cell text
// into one comparable string — a separator that can never itself appear in a
// real header cell, unlike a comma or pipe.
const HEADER_FINGERPRINT_SEPARATOR = '␟';

/** A stable fingerprint for a header row, used to recognize the SAME file
 * shape again later (an "Other" bank's saved mapping is keyed by this). */
export const headerFingerprint = (row: TableCell[]): string =>
  row.map((cell) => String(cell).trim()).join(HEADER_FINGERPRINT_SEPARATOR);

/** The `settings.statementMappings` key a mapping is saved/looked-up under: a
 * catalog `BankId` mapping is keyed by the bank itself (`bank:<bankId>`), so
 * every file imported for that bank shares one saved mapping; any other
 * account ("Other") is keyed by its header row's own fingerprint instead. */
export const mappingKeyFor = (bankId: string | null | undefined, fingerprint: string): string =>
  isBankId(bankId) ? `bank:${bankId}` : `header:${fingerprint}`;

/**
 * Looks up a saved mapping for the file about to be imported. A known
 * catalog bank checks its OWN `bank:<bankId>` entry only — `exact` is true
 * only when the file's actual header row (at the saved mapping's own
 * `headerRowIndex`) still fingerprints to the same value, so a bank whose
 * export format changed still pre-fills (for convenience) but is flagged
 * inexact rather than silently trusted. An unrecognized/absent bank ("Other")
 * has no single bank key to check, so it instead scans every `header:` entry
 * for one whose fingerprint matches the file — always exact when found,
 * since a `header:` entry means nothing except that fingerprint match.
 */
export const findSavedMapping = (
  saved: Record<string, SavedColumnMapping> | null | undefined,
  bankId: string | null | undefined,
  rows: TableCell[][],
): { mapping: SavedColumnMapping; exact: boolean } | undefined => {
  if (!saved) {
    return undefined;
  }

  const isExactMatch = (mapping: SavedColumnMapping): boolean =>
    headerFingerprint(rows[mapping.headerRowIndex] ?? []) === mapping.fingerprint;

  if (isBankId(bankId)) {
    const bankMapping = saved[mappingKeyFor(bankId, '')];

    return bankMapping ? { mapping: bankMapping, exact: isExactMatch(bankMapping) } : undefined;
  }

  const headerEntry = Object.entries(saved).find(
    ([key, mapping]) => key.startsWith('header:') && isExactMatch(mapping),
  );

  return headerEntry ? { mapping: headerEntry[1], exact: true } : undefined;
};
