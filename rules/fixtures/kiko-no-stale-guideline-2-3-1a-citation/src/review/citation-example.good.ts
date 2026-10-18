// Semgrep fixture (NEGATIVE): a dated note of the remediation event, or a line that names the
// current guideline, stays clean under `kiko-no-stale-guideline-2-3-1a-citation`.

// The screenshot seed left src/ in the Guideline 2.3.1(a) remediation.
export const remediationNote = true;

// Cited as formerly 2.3.1(a) before the reviewer renumbered it.
export const formerlyNote = true;

// Guideline 2.3.1(a), now 2.5.19, bars hidden features.
export const nowNote = true;

// Guideline 2.5.19 bars hidden features.
export const currentCitation = true;

// Vendor clause 12.3.1(a) is not a guideline citation.
export const digitBeforeTheNumber = true;

export const testTitle = 'keeps the 2.3.1(a) remediation seed out of the bundle';
