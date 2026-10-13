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

/**
 * A multi-line block comment that opens plainly and only names the history
 * word on a later line, so the block arm has to walk past the first line. The
 * finding is reported at the word itself, so the pin sits inside the comment:
// EXPECT-FINDING
 * the old picker no longer ships.
 */
export const noLongerLaterBlockLine = true;

// EXPECT-FINDING
// The sheet never used to flicker before the redesign.
export const neverUsedToHistory = true;

// EXPECT-FINDING
// was: 30
export const wasLabelLine = 60;

// EXPECT-FINDING
export const wasLabelAfterCode = 60; // was: 30 before the cap moved

// EXPECT-FINDING
/* was: the old cap */
export const wasLabelBlock = 60;

/**
 * A multi-line block comment that names the label only on a later line:
// EXPECT-FINDING
 * was: the old cap.
 */
export const wasLabelLaterBlockLine = 60;

// Known false positives of the label member, pinned as findings: it keys on the word and its
// colon alone, so prose, a URL path segment and a JSDoc example read as a label too. Reword such
// a comment, or drop the colon.
// EXPECT-FINDING
// The open question was: does the row hold a balance?
export const wasProse = true;

// EXPECT-FINDING
// see http://example.com/was:thing
export const wasInUrl = true;

// EXPECT-FINDING
/** Example: `{ was: 1 }` is the shape. */
export const wasInJsdocExample = true;

// Known limits, pinned as findings: the lookbehind sees only the word right before the phrase,
// so a purpose sentence with another word in between, or a line break after the verb, still
// reads as history. Reword such a comment to name the purpose.
// EXPECT-FINDING
// A cursor is only used to resume the page after a failed run.
export const onlyUsedToPurpose = true;

// The cursor is
// EXPECT-FINDING
// used to resume the page after a failed run.
export const splitUsedToPurpose = true;

/**
 * A second word in the same block comment is reported too, at its own line:
// EXPECT-FINDING
 * the old picker no longer ships,
// EXPECT-FINDING
 * and it previously rendered twice.
 */
export const secondWordInBlock = true;

// The refactor-narrative phrases of a test comment: a look "as drawn today", a test "kept green"
// through an extraction, "the move onto" a shared component.
// EXPECT-FINDING
// The toggle as drawn today, pinned so a later change draws no pixel differently.
export const asDrawnToday = true;

// EXPECT-FINDING
// The rows as rendered today keep their order.
export const asRenderedToday = true;

// EXPECT-FINDING
// Written against the inline rows and kept green while they were reshaped.
export const keptGreen = true;

// EXPECT-FINDING
// Pinned so the move onto the shared toggle changes no pixel.
export const moveOnto = true;

// EXPECT-FINDING
// The look carries over the move into the shared card unchanged.
export const moveInto = true;

// EXPECT-FINDING
// The rows keep their layout through their extraction into a card.
export const throughTheirExtraction = true;

// EXPECT-FINDING
// The rows keep their layout through the extraction into a card.
export const throughTheExtraction = true;

// The same phrases at the start of a sentence, and the three the first pass left unpinned.
// EXPECT-FINDING
// Kept green while the rows were reshaped into a card.
export const keptGreenCapital = true;

// EXPECT-FINDING
// As drawn today, the toggle sits flush with the label.
export const asDrawnTodayCapital = true;

// EXPECT-FINDING
// As rendered today, the rows keep their order.
export const asRenderedTodayCapital = true;

// EXPECT-FINDING
// The rows keep their layout as written today.
export const asWrittenToday = true;

// EXPECT-FINDING
// As written today, the label reads on its own.
export const asWrittenTodayCapital = true;

// EXPECT-FINDING
// The rows keep their layout as built today.
export const asBuiltToday = true;

// EXPECT-FINDING
// As built today, the rows keep their order.
export const asBuiltTodayCapital = true;

// EXPECT-FINDING
// The move onto the shared toggle changes no pixel.
export const moveOntoCapital = true;

// EXPECT-FINDING
// The move into the shared card changes no pixel.
export const moveIntoCapital = true;

// EXPECT-FINDING
// The rows keep their layout through its extraction into a card.
export const throughItsExtraction = true;

// EXPECT-FINDING
// Through their extraction into a card the rows keep their layout.
export const throughTheirExtractionCapital = true;

// EXPECT-FINDING
// Through the extraction into a card the rows keep their layout.
export const throughTheExtractionCapital = true;

// A second word on the same line is reported too (one pin covers the line, since a pin
// names a line, not a member).
// EXPECT-FINDING
// The sheet no longer pushes a duplicate and previously pushed two.
export const secondWordOnLine = true;
