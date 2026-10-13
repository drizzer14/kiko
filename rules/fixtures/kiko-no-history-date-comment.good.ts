// Semgrep fixture (NEGATIVE): every shape below carries a date or a watched word, but
// never as a date attached to a ruling, a finding, or a plan, or never in a comment at
// all. `kiko-no-history-date-comment` must draw ZERO findings from this file.

// 1. The words and dates inside a STRING literal (not a comment): the rule reads comment
// text only, so none of these is in scope.
export const strings = ['approved 2026-10-08', 'Device finding', '(plan, 2026-09-11)'];

// 2. A `//` inside a STRING literal, not a real line comment: the line arm's same-line
// string skip must not open a match on it.
export const urlNote = 'see https://example.test // confirmed 2026-09-12';

// 3. A date that is DATA in a comment: a fixture day, a DST day, a leap day, a cell of a
// worked example. No ruling, finding, or plan word sits before it.
// Europe/Kyiv falls back on 2026-10-25, so that local day has 25 hours.
export const dstDay = Date.UTC(2026, 9, 25); // 2026-10-25
// Opened 2024-01-11; the first accrual runs from Jan 12.
// 98 x UA4000239115 bought at 1,076.72 each on 2026-09-10; the seller shows 15.40%.
// A naive Date.parse('2019-10-12 11:12:02') reads it in the local zone.
export const fixtureDay = 1;

// 4. A date written as provenance of a snapshot, a probe, or a check: it records WHEN a
// value was captured, which the code cannot show, not a ruling or a plan.
// Fallback FX snapshot captured 2026-09-22; approximate.
// cldr-core/supplemental/weekData.json, checked 2026-09-26 by a CLDR diff.
// The server answers 13 months back (probed 2026-10-06) with 200.
export const provenance = 1;

// 5. A parenthesized date inside a sentence, not opening the comment text.
// Installment 12 falls due 2025-07-01, before `now` (2025-07-15).
export const parenthesizedInside = 1;

// 6. A watched word with no date next to it: an approval or a ruling named without a
// date, a device or a finding on their own, a docs path with no date.
// The accent was user-approved, so the tint stays.
// By user ruling, a Settings row that opens a screen reads in Title Case.
// The device reports the finding through the native module.
// See docs/design/ios-hig-audit.md for the contrast numbers.
export const noDate = 1;

// 7. A plan, a track, or a round named with no date after the comma.
// (multi-account plan, step one) is handled by the migration below.
// The CASE track, then the loop, runs in order.
export const noDateAfterComma = 1;

// 8. A date glued after a word that is not a ruling or a plan: a sentence about a day.
// The nightly job ran, then 2026-09-01 was the first month start.
export const otherWord = 1;

// 9. A comment that holds no watched member never lets the rule read the code after it:
// a string with the member on the same line as a closed block comment, or on the line
// below a line comment, stays silent.
export const memberStringAfterBlock = /* a plain note */ 'approved 2026-10-08';
// A plain note.
export const memberStringBelowLine = 'Device finding';

// 10. A ruling that names no date after "of" or "on": a ruling of the layout, a ruling on amounts.
// The ruling of the layout stays as written, and a ruling on amounts rounds half up.
export const rulingWithoutDate = 1;
