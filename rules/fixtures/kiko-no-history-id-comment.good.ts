// Semgrep fixture (NEGATIVE): every shape below LOOKS like a task id,
// review-round id, spec/decision id, or bug number but is not one —
// `kiko-no-history-id-comment` must draw ZERO findings from this file.

// 1. i18n/ISIN/encoding/currency-standard names: a letter run followed by
// digits, but never inside the SAME word boundary as the denylisted
// letters, and never actually one of them (i18n, ISIN, UTF-8, ISO 4217).
export const localeNote = 'i18n locale files live under src/i18n/locales';
export const isinNote = 'ISIN validation follows ISO 6166';
export const encodingNote = 'UTF-8 only; Hermes has no TextDecoder';
export const currencyStandardNote = 'currency codes follow ISO 4217';

// 2. A `T` glued directly to the date before it (an ISO instant), with no
// boundary between the date's own digits and the `T` — never a task id:
// 2026-09-25T10:00:00.000Z is a plain timestamp.
export const sampleInstant = '2026-09-25T10:00:00.000Z';

// 3. A hex color, where the run of hex digits never leaves a boundary at
// exactly one of the denylisted letters — #3366FF reads as one continuous
// hex run, not F as a standalone id. Named, not a bare literal, so this
// fixture also stays silent under kiko-no-raw-color-literal (its own
// negative fixture covers that rule's boundary cases).
export const brandColorNote = 'a hex run like #3366FF stays one continuous token';

// 4. A short identifier shaped like a denylisted id, but only ever written
// in real CODE (never inside a comment) — this rule only reads comment
// text, so the const name below is out of its scope entirely.
const shortLocalConstant = 'not a review id, just a local const name';
export const referencesShortLocalConstant = (): string => shortLocalConstant;

// 5. A denylisted letter+digit glued INSIDE a real camelCase domain word —
// no word boundary on either side, so it is never mistaken for a
// standalone id: computeD1Delta returns the day-over-day change, and
// applyM2Adjustment folds it into the running total.
export const domainWordNote = 'computeD1Delta, applyM2Adjustment';

// 6. An SF Symbol name: dot-separated words, never a denylisted letter
// glued to digits.
export const cryptoSymbolName = 'bitcoinsign.circle';

// 7. A test id inside a STRING (not a comment) — this rule only reads
// comment text, so a `testID` value is never in scope.
export const rowTestId = 'transaction-row-T1';

// 8. A `//` inside a STRING literal, not a real line comment — the
// line-comment arm's leading same-line-string skip must not open a match on
// a `//` still inside an unclosed quote.
export const oddNote = 'foo // T12';

// 9. A `/*` inside a STRING literal (a glob or a MIME wildcard), not a real
// block-comment opener — the block-comment arm's same skip must not open a
// match there either.
export const globPattern = 'src/**/*.ts';
export const mimeWildcard = '*/*';

// 10. "round"/"Phase" prose with no id shape behind it: sending a value on
// a round trip through the API, or a comment that reads Phase 1 copies the
// rows; Phase 2 deletes the source only after commit — round-N anchors on
// its own hyphen+digit shape, and a bare "Phase N" is not a family member
// at all (a real "Phase N (Task M)" citation is still caught by the
// existing Task-N family member instead — see the .bad.ts fixture), so
// plain English "round"/"phase" prose never collides with either.

// 11a. Requirement Details are provided at checkout. A real word follows
// "Requirement", not a single bare letter — the regex only ever captures
// ONE letter, so this fails the trailing `\b` boundary: more letters
// (`etails`) follow the captured `D`, so word meets word, not a boundary.

// 11b. The payments controller routes requests directly. The literal word
// "ruling" never appears at all here, so this fails the literal-text match
// itself, before any boundary check would even run.

// 11c. The settings section groups items by category. The literal
// capital-letter-dot-digit shape after "section" never appears either —
// same reason as 11b, a literal-text miss, not a boundary check.

// 11d. The task briefing covered every account before go-live. The
// narrowed task/parity-brief family's own trailing `\b` fails the same way
// an ordinary "-ing" continuation always does — see item 5's
// `computeD1Delta` for the same word-boundary trick.

// 12. The narrowed task/parity-brief family must not match this ordinary
// prose collision: hide the header during the brief window so the sheet
// reads as uninterrupted — no "task"/"parity" qualifier appears before
// "brief", so the narrowed family never opens a match at all.

// 13. The new per-the-brief/the-brief's member must not match ordinary
// adjective use of "brief" either: a brief native spinner covers the
// fetch, and the modal stays open only a brief moment — neither "per the"
// nor a possessive "'s" follows "brief" here, so the new member never
// opens a match.

// 14. The debugger-report family (SYNC/INT/TWIN/TX/HOLD/BAK/STAT/AUTH/PERF/
// SEC/DEP/DEPS/CS, each hyphen-glued to digits) requires an EXACT uppercase
// prefix — ordinary prose using the same words differently never opens a
// match: the sync step finishes before the int cast runs (lowercase, no
// hyphen glued to a digit).
export const debuggerReportFamilyNearMiss = true;

// 15. Regression lock: common technical terms shaped like WORD-digit(s)
// that must never collide with any family above, present or future — UTF-8,
// SHA-256, ISO-8601, and Windows-1251 (the CSV encoding this app's own
// statement-import feature reads) are real domain vocabulary, not a
// debugger-report id.
export const technicalTermRegressionLock = 'UTF-8, SHA-256, ISO-8601, Windows-1251';

// 16. The plan-history members need a citation shape (a numbered decision,
// a possessive, a "doc" suffix, or a "per"/"by" lead-in), so domain prose
// about an import plan, a user's decision, or a database commit stays silent:
// Compute the plan (pure). The rezone plan runs once per import, a decision
// the user makes on the review sheet, and each batch commits in one
// transaction.
export const planHistoryMembersNearMiss = true;

// 17. The section members need a number after the word: a "Section" header
// row, a section list, 2 sections, and the settings subsection 2.1 of a
// statement stay silent, as does a lone § sign with no digit after it.
export const sectionMembersNearMiss = true;

// 18. The later plan and commit members need their whole citation shape:
// Separate committed rows from pending ones. The reminders planner keeps
// this planning window open, and this planner also skips a muted slot.
// A row in this planned transfer and the 2026-09-11 import run stay silent.
export const laterPlanMembersNearMiss = true;

// 19. The hyphenated single-letter ids need a digit right after the hyphen,
// and the id letter needs a word boundary before it: a T-shirt size, a
// U-turn, UTF-8, UTC-1, GMT-5, and a NEWS-1 feed or a renewal NEW-look
// banner stay silent, as do a lowercase t-1 and a NEW row. `D` takes no
// hyphen, because day D-1 is the day before the purchase day D.
export const hyphenatedIdNearMiss = 'T-shirt, U-turn, UTF-8, UTC-1, GMT-5';

// 20. The user-request members need their citation shape, a date right after
// the words or a past-tense "asked for" opening a sentence: a user request
// to the server, user feedback shown as a toast, a retry only if the user
// asked for one, a file the user requested, and a sheet the user can tap
// stay silent, as does a sync that runs when the user asks for it.
export const userRequestNearMiss = true;

// 21. The branch, task, option, plan, and review members need their whole
// citation shape: an optional row, the Options list, an option A/B toggle,
// a branch on this path, the plan keeps its slot, and review the rows, then
// retry all stay silent.
export const citationShapeNearMiss = true;

// 22. The commit-range member needs two 7-40 character hex ids around the
// dots: a 0..255 byte, the a..f digits, cafe..beef, and 1234567.89 stay
// silent.
export const commitRangeNearMiss = true;

// A git id holds a hex letter, so a span of two epoch-millisecond numbers
// stays silent: the fixture clock spans 1700000000000..1700086400000.
export const digitRangeNearMiss = true;
