// Semgrep fixture (NEGATIVE): JSX comments that carry a remediation marker or the current number
// stay clean under `kiko-no-stale-guideline-2-3-1a-citation`.

export const AllowedCitations = () => (
  <>
    {/* Dev-only data left src/ in the Guideline 2.3.1(a) remediation. */}
    {/* Guideline 2.3.1(a), now 2.5.19. */}
    {/* Guideline 2.5.19: nothing is hidden. */}
    {null}
  </>
);
