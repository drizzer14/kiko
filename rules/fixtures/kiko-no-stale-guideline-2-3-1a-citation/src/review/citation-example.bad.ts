// Semgrep fixture (POSITIVE): the no-hidden-feature rule is cited as Guideline 2.5.19, so a bare
// `2.3.1(a)` on a line with no remediation marker is a stale citation.
// `kiko-no-stale-guideline-2-3-1a-citation` MUST report a finding on each pinned line below.

// EXPECT-FINDING
// Nothing is gated behind a flag (Guideline 2.3.1(a)).
export const trailingParenthesis = true;

// EXPECT-FINDING
// App Store Guideline 2.3.1(a): every feature ships visible to the reviewer.
export const leadingCitation = true;

// EXPECT-FINDING
/* Guideline 2.3.1(a) forbids hidden features. */
export const blockComment = true;

// EXPECT-FINDING
export const quotedTitle = 'hidden features break Guideline 2.3.1(a)';

// EXPECT-FINDING
export const dateAloneIsNotAnAllowance = '2026-09-19 Guideline 2.3.1(a)';

// EXPECT-FINDING
export const otherWordsAreNotAnAllowance = 'Guideline 2.3.1(a) was formerly cited elsewhere';

// EXPECT-FINDING
export const nowWithoutVersionIsNotAnAllowance = 'now Guideline 2.3.1(a)';
