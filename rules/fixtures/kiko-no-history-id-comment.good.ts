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
// boundary between the date's own digits and the `T` — never a task id.
export const sampleInstant = '2026-09-25T10:00:00.000Z';

// 3. A hex color, where the run of hex digits never leaves a boundary at
// exactly one of the denylisted letters.
export const brandColor = '#3366FF';

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

// 10. "round"/"Phase" prose with no trailing digit — the `round-N` and
// `Phase N (Task` families anchor on the digit that follows, so ordinary
// English never collides with them, unlike a bare letter-plus-digit
// standalone token from one of the review-id families (kiko-linter's own
// note on that accepted, undodged gap).
export const roundTripNote = 'send it on a round trip through the API';
export const finalPhaseNote = 'this is the final phase of testing';

// 11. Near-misses for the id families added alongside `Phase N`: a real
// capitalized word after "Requirement" (not a single bare letter), a
// "controller" mention with no trailing "ruling N", a "section" mention
// with no trailing "capital-letter.digit", and "the briefing" (not "the
// brief") — each fails the trailing `\b` boundary the real id shape needs.
export const requirementDetailsNote = 'Requirement Details are provided at checkout';
export const paymentsControllerNote = 'the payments controller routes requests directly';
export const settingsSectionNote = 'the settings section groups items by category';
export const briefingNote = 'the briefing covers every account before go-live';
