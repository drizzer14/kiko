// Semgrep fixture (POSITIVE): kiko-code-style's "Comments: WHY only, never
// history" bans a change narrative left behind in a comment. A comment states
// how the code works today, not how it worked before. `kiko-no-history-word-
// comment` MUST report a finding on each pinned line below, in a `//` line
// comment, in a `/* */` block comment, and after code on the same line.

// EXPECT-FINDING
// The sheet no longer pushes a duplicate instance.
export const noLongerLine = true;

// EXPECT-FINDING
// No longer suffixed with "(optional)" — the label reads on its own.
export const noLongerCapital = true;

// EXPECT-FINDING
/* The header no longer resets the scroll offset. */
export const noLongerBlock = true;

// EXPECT-FINDING
export const noLongerAfterCode = 1; // The cache no longer evicts early.

// EXPECT-FINDING
export const noLongerAfterString = 'a // b'; // The cache no longer evicts early.

// EXPECT-FINDING
// This used to render a spinner while the rows loaded.
export const usedToHistory = true;

// EXPECT-FINDING
/* The wrapper used to own this padding. */
export const usedToBlock = true;

// EXPECT-FINDING
// The key used to match the row, so a rename dropped it.
export const usedToAfterNoun = true;

// EXPECT-FINDING
// A header is used to size the sheet, and the footer used to size it too.
export const usedToAfterExcludedShape = true;

// EXPECT-FINDING
// Previously the pick was persisted into the draft.
export const previouslyCapital = true;

// EXPECT-FINDING
// The footer previously rendered as scroll content.
export const previouslyLower = true;

// EXPECT-FINDING
// The previously-synced holding keeps its stored id.
export const previouslyHyphenated = true;

// EXPECT-FINDING
/* The icon previously fell back to the default symbol. */
export const previouslyBlock = true;

// EXPECT-FINDING
// A narrow scan: it replaces the hand-rolled loop that walked every row.
export const itReplacesLower = true;

// EXPECT-FINDING
// It replaces the old three-step lookup.
export const itReplacesCapital = true;

// EXPECT-FINDING
/* The helper it replaces ran once per row. */
export const itReplacesBlock = true;

// EXPECT-FINDING
/**
 * A multi-line block comment that opens plainly and only names the history
 * word on a later line, so the block arm has to walk past the first line:
 * the old picker no longer ships.
 */
export const noLongerLaterBlockLine = true;
