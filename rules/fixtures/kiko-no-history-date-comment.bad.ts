// Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never
// history" bans a date attached to a ruling, a finding, or a plan left behind in
// a comment. `kiko-no-history-date-comment` MUST report a finding on each pinned
// line below, in a `//` line comment, in a `/* */` block comment, and after code
// on the same line.

// EXPECT-FINDING
// Tinted fill of the card (user-approved 2026-10-08), so a hint reads as its own.
export const approvedLine = true;

// EXPECT-FINDING
// Settings rows in Title Case by user ruling 2026-10-08, so each row matches the nav title.
export const rulingLower = true;

// EXPECT-FINDING
// User ruling 2026-10-08: a row that opens a screen reads in Title Case.
export const rulingCapital = true;

// EXPECT-FINDING
// The label was decided on 2026-10-08 with the other captions.
export const decidedOn = true;

// EXPECT-FINDING
// Rows stay flat; confirmed 2026-09-12 on the categories screen.
export const confirmedDate = true;

// EXPECT-FINDING
// The server answers 13 months back (probed 2026-10-06) with 200.
export const probedLine = true;

// EXPECT-FINDING
// Probed on 2026-10-13: a start 180 days back is served and one 200 days back is refused.
export const probedOnCapital = true;

// EXPECT-FINDING
/* The depth is 180 days, probed 2026-10-13, and a start older than it is refused. */
export const probedBlock = true;

// EXPECT-FINDING
export const probedAfterCode = 1; // Keeps 180 days, probed 2026-10-13.

// EXPECT-FINDING
/* The pill is pinned to 5 rows, as ruled 2026-09-30 for this table. */
export const ruledBlock = true;

// EXPECT-FINDING
// Device finding: with an error, the inner field grew and pushed the row down.
export const deviceFindingLower = true;

// EXPECT-FINDING
// A device finding showed the footer overlapping the last row.
export const deviceFindingProse = true;

// EXPECT-FINDING
/* Device finding: the sheet flickered on first open. */
export const deviceFindingBlock = true;

// EXPECT-FINDING
export const deviceFindingAfterCode = 1; // Device finding: the count lagged one tap.

// EXPECT-FINDING
export const afterString = 'a // b'; // Device finding: the count lagged one tap.

// EXPECT-FINDING
// Binance connections bind their own key pair (multi-account plan, 2026-09-11).
export const planDate = true;

// EXPECT-FINDING
// The noun stays lowercase mid-string here (CASE track, 2026-09-24).
export const trackDate = true;

// EXPECT-FINDING
// The row keeps its caption (fix round, 2026-09-14).
export const roundDate = true;

// EXPECT-FINDING
// See `docs/design/2026-09-10-ios-hig-audit.md` for the contrast numbers.
export const datedDocsPath = true;

// EXPECT-FINDING
// Dark palette from docs/superpowers/specs/2026-08-30-kiko-foundation-design.md and the skill.
export const datedSpecPath = true;

/**
 * A comment whose line opens with a parenthesized date:
// EXPECT-FINDING
 * (2026-09-11) moves the secret to a per-account item.
 */
export const parenthesizedDateAtLineStart = true;

// EXPECT-FINDING
// (2026-09-11) moves the secret to a per-account item.
export const parenthesizedDateLineComment = true;

/**
 * A multi-line block comment that opens plainly and only names the dated ruling
 * on a later line, so the block arm has to walk past the first line. The finding
 * is reported at the date itself, so the pin sits inside the comment:
// EXPECT-FINDING
 * it was approved 2026-10-08 by the user.
 */
export const laterBlockLine = true;

// EXPECT-FINDING
// Rows stay flat, per the ruling of 2026-10-12 on the categories screen.
export const rulingOfDate = true;

// EXPECT-FINDING
/* The footer stays pinned, the ruling of 2026-10-12 says so. */
export const rulingOfDateBlock = true;

// A form split across a comment wrap is reported at the line the word `ruling` is on.
// EXPECT-FINDING
// Rows stay flat, per the ruling of
// 2026-10-12 on the categories screen.
export const rulingOfDateWrappedLine = true;

// EXPECT-FINDING
/* The footer stays pinned, the ruling of
 * 2026-10-12 says so. */
export const rulingOfDateWrappedBlock = true;

// EXPECT-FINDING
// Rows stay flat, per the ruling
// 2026-10-12 on the categories screen.
export const rulingDateWrappedLine = true;

/**
 * A second member in the same block comment is reported too, at its own line:
// EXPECT-FINDING
 * Device finding: the row jumped,
// EXPECT-FINDING
 * and the user ruling 2026-10-08 fixed the height.
 */
export const secondMemberInBlock = true;
