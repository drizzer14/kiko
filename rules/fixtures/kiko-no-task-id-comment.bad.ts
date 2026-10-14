// Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never
// history" bans a task, step, finding, or spec id left behind in a comment.
// `kiko-no-task-id-comment` MUST report a finding on each pinned line below,
// in a `//` line comment, in a `/* */` block comment, and after code on the
// same line.

// EXPECT-FINDING
// DEVICE BUG fix: the search field keeps the keyboard up.
export const deviceBugLine = true;

// EXPECT-FINDING
/* DEVICE BUG: a fixed white glyph fails contrast on the light tile. */
export const deviceBugBlock = true;

// EXPECT-FINDING
export const deviceBugAfterCode = 1; // DEVICE BUG fix (root cause): the sheet clips.

// EXPECT-FINDING
export const deviceBugAfterString = 'a // b'; // DEVICE BUG fix: the sheet clips.

// EXPECT-FINDING
// BUG A fix 1: the marker is written in the same transaction as the balance.
export const bugLetterUpper = true;

// EXPECT-FINDING
// The tab bar keeps its own background (Bug B1).
export const bugLetterDigits = true;

// EXPECT-FINDING
// Dropping the inset is bug A2; the base step stays.
export const bugLetterLower = true;

// EXPECT-FINDING
// Feature 1 seeds the counterpart amount from the cached rate.
export const featureNumber = true;

// EXPECT-FINDING
// The write-only-secret order (Global Constraint 2) runs the sync last.
export const globalConstraint = true;

// EXPECT-FINDING
// The picker excludes a synced holding (item 6).
export const itemLower = true;

// EXPECT-FINDING
// Item 5: dividers bracket the card above and below.
export const itemCapital = true;

// EXPECT-FINDING
// A stable ticker gives the name rule something to match (item 2/3/4).
export const itemSlashList = true;

// EXPECT-FINDING
// Rows missing a closing balance fall back to none (Part A).
export const partLetter = true;

// EXPECT-FINDING
// The reserved slot is gone after Track A's reflow.
export const trackLetter = true;

// EXPECT-FINDING
// Invariant #15 (backup completeness): every table is in the snapshot.
export const invariantNumber = true;

// EXPECT-FINDING
// The parse step catches a thrown error (CRITICAL #1).
export const criticalNumber = true;

// EXPECT-FINDING
// The import keeps its own sort (MAJOR #2).
export const majorNumber = true;

// EXPECT-FINDING
// The label keeps its own width (MINOR #3).
export const minorNumber = true;

// EXPECT-FINDING
// This guards the leak that Finding X1 reported.
export const findingCapital = true;

// EXPECT-FINDING
// This guards the leak the security finding S4 reported.
export const findingLetterDigit = true;

// EXPECT-FINDING
// One tree-flattener instead of four copies (ponytail L43).
export const ponytailLine = true;

// EXPECT-FINDING
// The sheet height is clamped here (SEC-A1).
export const hyphenFindingSec = true;

// EXPECT-FINDING
// Rebuilds the table once per refresh, see REF-B14 for the reason.
export const hyphenFindingRef = true;

// EXPECT-FINDING
// The delete runs inside the same batch (TX-B6a).
export const hyphenFindingLowercase = true;

// EXPECT-FINDING
// The default holding is seated first (A1): the form never opens empty.
export const parenLetterDigit = true;

// EXPECT-FINDING
// PrivatBank, PUMB, and Oschadbank (P3) have no dedicated parser.
export const parenLetterPlanId = true;

// EXPECT-FINDING
/* The item picker keeps its sort (item 3), as the summary table does. */
export const itemBlock = true;

// EXPECT-FINDING
export const itemAfterCode = 1; // The filter stays on (item 4).

// EXPECT-FINDING
export const itemAfterString = 'a // b'; // The filter stays on (item 4).

/**
 * A multi-line block comment that opens plainly and only names the id on a
 * later line, so the block arm has to walk past the first line. The finding is
 * reported at the id itself, so the pin sits inside the comment:
// EXPECT-FINDING
 * the picker keeps its sort (item 3).
 */
export const idLaterBlockLine = true;

/**
 * A second id in the same block comment is reported too, at its own line:
// EXPECT-FINDING
 * the sheet clips (DEVICE BUG),
// EXPECT-FINDING
 * and the bar flips (Bug B1).
 */
export const secondIdInBlock = true;

// Known limit, pinned as a finding: `item` plus a number reads as an id even in plain prose, and
// so does a parenthesized letter and digit like `(A1)` for a spreadsheet cell. Reword such a
// comment ("the third item", "cell A1").
// EXPECT-FINDING
// Each item 3 levels down keeps its own sort.
export const itemProseLimit = true;

// A second id on the same line is reported too (one pin covers the line, since a pin names a
// line, not a member).
// EXPECT-FINDING
// The picker keeps its sort (item 3) and the filter stays on (item 4).
export const secondIdOnLine = true;

// EXPECT-FINDING
// The sheet keeps its height per ruling A2: the footer never scrolls.
export const rulingLetterId = true;

// EXPECT-FINDING
/* Per Ruling B14, the toggle stays flat. */
export const rulingLetterIdBlock = true;

// EXPECT-FINDING
// The footer stays pinned per RULING A2: the sheet never scrolls.
export const rulingUpperCase = true;

// EXPECT-FINDING
// The footer stays pinned per ruling A2b: the sheet never scrolls.
export const rulingTrailingLetter = true;

// EXPECT-FINDING
// The rulings A2 and B3 differ on the footer height.
export const rulingsPlural = true;

// A form split across a comment wrap is reported at the line the word `ruling` is on.
// EXPECT-FINDING
// The sheet keeps its height per ruling
// A2: the footer never scrolls.
export const rulingWrappedLine = true;

// EXPECT-FINDING
/* The toggle stays flat per ruling
 * B14, as the summary table does. */
export const rulingWrappedBlock = true;
