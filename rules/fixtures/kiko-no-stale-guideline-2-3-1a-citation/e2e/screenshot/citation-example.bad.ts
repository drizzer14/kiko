// Semgrep fixture (POSITIVE): the rule also covers the e2e/ tree.
// `kiko-no-stale-guideline-2-3-1a-citation` MUST report a finding on the pinned line below.

// EXPECT-FINDING
// Dev-only data, kept out of the bundle for Guideline 2.3.1(a).
export const screenshotCitation = true;
