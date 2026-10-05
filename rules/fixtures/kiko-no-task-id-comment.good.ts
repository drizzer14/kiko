// Semgrep fixture (NEGATIVE): every shape below reads like a task, step, finding, or spec id,
// but is a real standard, domain word, or code in a comment — or never in a comment at all.
// `kiko-no-task-id-comment` must draw ZERO findings from this file.

// 1. The ids inside a STRING literal (not a comment): the rule reads comment text only.
export const strings = ['DEVICE BUG fix', 'Feature 1', 'item 3', 'Bug A2', 'SEC-C1', '(A1)'];

// 2. A `//` inside a STRING literal, not a real line comment: the line arm's same-line-string
// skip must not open a match on it.
export const urlNote = 'see https://example.test // item 3';

// 3. Standards and units with a hyphen and a digit: the id shape needs a LETTER after the hyphen.
// UTF-8 text, a SHA-256 digest, an ISO-8601 instant, an ISO 4217 code, AES-256-GCM, BCP-47 tags.
// CLDR-14795 is an upstream ticket that explains a table gap, not a task of this repository.
// The window runs from UTC-9 to UTC+13:45, and NOW-2d marks the bucket two days back.

// 4. Prose around a watched word: "step", "task", "phase", "feature", "item", and "bug" with no
// id after them.
// The first step reads the file, the next step maps its columns.
// task 0 settles LAST and task 1 first, so the result array keeps its input order.
// Phase A of the rezone moves every key to a temporary one, and phase B writes the final key.
// Step 1 derives X:UAH from an inverse row; step 2 derives it through a cross rate.
// The feature flag is read once. Every list item is keyed by its id, and an item can nest.
// The bug is in the clamp, a bug I traced to the scroll offset, and a bug. A new test pins it.
// The reported bug surfaces only on a device with the keyboard up.
// THE POSITION-SCALING BUG: a clamp that floors a negative target at zero is wrong.

// 5. A single letter in parentheses, a function call, or a range in a comment: not an id.
// The pivot rate is `uahPer(A) / uahPer(B)`, and the synced debit (Q) and typed price (P) differ.
// Group every holding by its account in one O(H) pass.
// Row 1 is a merged A1:J1 range, and cell A1 holds the title prefix.
// A single-letter variant picks the (B) side only in a code sample.

// 6. Cloud and heading names that look like a letter and a digit in parentheses: the S3 bucket
// (S3), an (H1) heading level, and the A12 Bionic chip.

// 7. A part, track, or invariant word without a letter or number id.
// Part of the flow runs on the main thread. A track of the sort is kept for the next page.
// The invariant holds for every row. Invariant checks run before each write.

// 8. A hash followed by a number that is not a spec id: a hex color, a fire order in a test.
// Fire #1 starts the older query, fire #2 starts the newer one.
// The track reads `#111112` over the surface, and `#636366` for the thumb.

// 9. A finding word with no id: the security finding was fixed, a finding in the report.
// This guards the leak the review found, and a finding of the same kind stays rejected.

// 10. A hyphenated token with a lowercase or digit run after the hyphen, or one letter prefix.
// X-Api-Key is a request header, T-Mobile a carrier, and WCAG-AA a contrast level.
// The ponytail review lists a few findings, with no line reference in this comment.

// 11. A multi-line block comment holding only plain WHY text:
/**
 * The cursor resumes the page after a failed run, so the retry never re-reads
 * a row it already wrote.
 */
export const plainBlock = true;

// 12. A comment that holds no id never lets the rule read the code after it: a string with an
// id on the same line as a closed block comment, or on the line below a line comment, stays
// silent.
export const idStringAfterBlock = /* a plain note */ 'DEVICE BUG fix (item 3)';
// A plain note.
export const idStringBelowLine = 'Bug A2 and Feature 1';
