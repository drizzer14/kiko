// src/i18n/locales/en.final-stop-by-role.test.ts
//
// One final-"." rule per UI role (F4 full-stop DECISION, 2026-09-24 — the
// binding measure + decision lives in
// .superpowers/sdd/shares-property-metals-debts/fullstop-measure.md):
//
//   No final "." — titles, headings, sheet titles, buttons, chips/options,
//   menu items, field labels, placeholders, empty states, alert titles,
//   progress/status text, "Label: {{value}}" strings.
//   Final "." always (or "?" when the body is a question) — option
//   descriptions/subtitles, captions/hints, errors, toast/alert bodies, even
//   for a fragment.
//
// Reuses `TITLE_KEYS` (`./title-keys.ts`, shared with
// `en.casing-by-role.test.ts`) for the no-final-"." side: a title/heading/
// sheet-title key is one of THOSE roles too. For the always-final-"." side,
// this checks the one role with a fully reliable, already-verified NAME
// convention: every leaf key ending `Error` (or `Error_<plural suffix>`) is
// an error message (`forms.holding.quantityError`,
// `columnMapping.dateColumnError`, ...) — NOT the bare `migration.error`
// status label, which does not end in capital-`Error` and is correctly
// exempt (a "Label: {{value}}" string, DECISION rule A). This does not
// re-derive the FULL per-key role classification the measure's own audit
// did for every other role (captions/hints, option subtitles, toast/alert
// bodies have no equally reliable name suffix to key off) — it mechanizes
// the two roles a name pattern verifies WITHOUT the Title-role's own blind
// spot (CASE fix round 1/5: a pattern can't silently exempt something from
// a check it's never applied to, only wrongly INCLUDE it — an `*Error` key
// that turns out not to be an error message would fail loudly here, not
// pass silently).
import { en } from './en';
import { uk } from './uk';
import { TITLE_KEYS } from './title-keys';
import { flattenCatalog } from './flatten-catalog';

const ERROR_KEY = /Error(_[a-z]+)?$/;

const leafName = (path: string): string => path.split('.').at(-1) ?? path;

// Titles disallow the DECLARATIVE final "." only — a confirm-sheet title
// phrased as a real question ("Replace All Data?", the measure's own
// documented outlier) still ends in "?" on purpose; that "?" is the
// sentence's own punctuation, not the DECISION's period rule.
const endsWithFinalPeriod = (value: string): boolean => value.trim().endsWith('.');

const endsWithFinalStop = (value: string): boolean => /[.?]$/.test(value.trim());

describe.each([
  ['en', en],
  ['uk', uk],
] as const)('%s catalog final "." follows one rule per UI role', (_label, catalog) => {
  const leaves = flattenCatalog(catalog);

  it('never ends a title/heading/sheet-title with a declarative final "."', () => {
    const offenders = leaves
      .filter(({ path }) => TITLE_KEYS.has(path))
      .filter(({ value }) => endsWithFinalPeriod(value));

    expect(offenders).toEqual([]);
  });

  it('always ends an *Error key\'s message with "." or "?", even a fragment', () => {
    const offenders = leaves
      .filter(({ path }) => ERROR_KEY.test(leafName(path)))
      .filter(({ value }) => !endsWithFinalStop(value));

    expect(offenders).toEqual([]);
  });

  it('covers a non-trivial number of keys in each checked role (the fixture is alive)', () => {
    const titleCount = leaves.filter(({ path }) => TITLE_KEYS.has(path)).length;
    const errorCount = leaves.filter(({ path }) => ERROR_KEY.test(leafName(path))).length;

    expect(titleCount).toBeGreaterThan(10);
    expect(errorCount).toBeGreaterThan(20);
  });
});
