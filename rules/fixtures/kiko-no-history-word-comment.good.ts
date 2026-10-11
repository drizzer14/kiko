// Semgrep fixture (NEGATIVE): every shape below carries a word the rule
// watches, but never in a comment's change-narrative sense — or never in a
// comment at all. `kiko-no-history-word-comment` must draw ZERO findings from
// this file.

// 1. The words inside a STRING literal (not a comment): the rule reads
// comment text only, so none of these is in scope.
export const strings = ['it no longer exists', 'previously stored', 'it replaces the row'];

// 2. A `//` inside a STRING literal, not a real line comment: the line arm's
// same-line-string skip must not open a match on it.
export const urlNote = 'see https://example.test // previously';

// 3. The purpose sense (a value, key, or helper that exists TO do something,
// as in the lines below). A passive lead-in (is, are, was, were, be, been, being, get,
// gets, got) or a copula-then-"never" lead-in (is/are/was/were never) is not the
// habit-in-the-past sense, so none of these opens a match.
// A key is used to match the holding.
// The ids are used to build the lookup map.
// The seed was used to derive the rows.
// The rows were used to drive every case below.
// A helper can be used to scope the query.
// A helper has been used to scope the query.
// A flag being used to gate the path is not a habit.
// A value that gets used to seed the form is not either.
// A value that got used to seed the form is not either.
// The raw string is never used to route a row.
// The ids are never used to build the lookup map.
// The seed was never used to derive the rows.
// The rows were never used to drive every case below.

// 4. A capitalized "Used to" opens a purpose fragment ("Used to price the
// buckets."), never a habit in the past, so it stays silent.
// Used to scope a held-holding query to crypto currencies only.

// 5. A word that merely CONTAINS a watched one, with no boundary on one
// side: a reused to-do list, an unused to-do list, and a used today counter.
// A reused to-do list stays as it is.
// An unused to-do list stays as it is.
// A used today counter stays as it is.

// 5b. Near misses of the refactor-narrative members: "as of today" is a date, not a look drawn
// before a change; a bare "move onto" names an action; "keeps ... green" is a present state.
// The value defaults to the day as of today.
// A move onto the next row advances the cursor.
// Each case keeps the suite green.

// 5c. The phrases name a refactor only with their full shape: a drag animation moves "into place",
// and a data "extraction" is a pipeline step, not an extracted component.
// Animate the move into place when the drag ends.
// Carry the booking date through the extraction so the parser keeps it.
// The move onto the next row advances the cursor.
// Through the extraction step the parser keeps the booking date.

// 6. A multi-line block comment holding only the excluded purpose shape:
/**
 * The cursor is used to resume the page after a failed run, so the retry
 * never re-reads a row it already wrote.
 */
export const purposeBlock = true;

// 7. A comment that holds no watched word never lets the rule read the code after it: a
// string with the word on the same line as a closed block comment, or on the line below a
// line comment, stays silent.
export const wordStringAfterBlock = /* a plain note */ 'it no longer exists';
// A plain note.
export const wordStringBelowLine = 'previously stored';

// 8. The old-value label needs the colon and a word boundary: the word in prose, the "wasm:"
// prefix, an object key, and a string are not a label narrating a previous value.
// The cap was derived from the row count.
// wasm: the module loads lazily.
export const wasKey = { was: 1 };
export const wasString = 'was: 30';
export const wasStringBeforeComment = 'was: 30'; // The cap holds the row count.
