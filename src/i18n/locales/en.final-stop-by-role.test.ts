// src/i18n/locales/en.final-stop-by-role.test.ts
//
// One final-"." rule per UI role (the binding measure + decision lives in
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
// sheet-title key is one of THOSE roles too. Every other check here is a
// name- or value-based pattern over the SAME `flattenCatalog` leaves this
// project's other catalog tests already share — each one a role with a
// fully reliable, already-verified convention (`*Error`, `*Placeholder`,
// `*Message`, `*Hint`, `*ErrorTitle` key-name suffixes; `kindSubtitle.*`
// path segment; a `"Label: {{value}}"` value shape). This does NOT
// re-derive the FULL per-key role classification the measure's own audit
// did for every other role (option subtitles, toast/alert bodies have no
// equally reliable name suffix to key off) — it mechanizes the roles a
// pattern verifies WITHOUT the Title role's own blind spot: a pattern can't
// silently exempt something from a check it's never applied to, only
// wrongly INCLUDE it — a wrongly-matched key fails LOUDLY here, not pass
// silently.
import { en } from './en';
import { uk } from './uk';
import { TITLE_KEYS } from './title-keys';
import { flattenCatalog } from './flatten-catalog';

const ERROR_KEY = /Error$/;
const PLACEHOLDER_KEY = /Placeholder$/;
const MESSAGE_KEY = /Message$/;
const HINT_KEY = /Hint$/;
const ERROR_TITLE_KEY = /ErrorTitle$/;
const KIND_SUBTITLE_PATH = /\.kindSubtitle\./;

// A short "Field label: {{value}}" fragment (`migration.error: 'Migration
// error: {{message}}'`, `accountDetail.lastSync: 'Last sync: {{time}}'`) —
// checked against the value with any trailing "." stripped first, so a
// value that WRONGLY carries one is still recognized as this shape (the
// point of the check) rather than skipped for not matching at all. The
// prefix disallows "." on purpose — a real field label is a short noun
// phrase, never its own sentence — which is what keeps this from misfiring
// on `statementImport.unrecognizedFormat` ("We don't recognize this file's
// format. Kiko can import statements from: {{formats}}.", a genuine
// multi-sentence body whose LAST clause happens to end "from: {{var}}").
// `isGovernedByAnotherRole` below additionally excludes a longer sentence
// with no internal "." of its own that merely happens to end "word:
// {{var}}" (uk's own `accountDetail.successMessage`, restructured so its
// count placeholder lands last) via its OWN `*Message` name instead.
const LABEL_VALUE_PATTERN = /^[^.:]+: \{\{\w+\}\}$/;
const LABEL_VALUE_ALLOWLIST = new Set([
  // The DECISION's own named exception: phrased as a label but treated as a
  // real error (it reports what went wrong reading a specific code), so it
  // keeps a final "." unlike every other "Label: {{value}}" string.
  'accountDetail.unsupportedCurrencyCode',
]);

const leafName = (path: string): string => path.split('.').at(-1) ?? path;

// Titles disallow the DECLARATIVE final "." only — a confirm-sheet title
// phrased as a real question ("Replace All Data?", the measure's own
// documented outlier) still ends in "?" on purpose; that "?" is the
// sentence's own punctuation, not the DECISION's period rule.
const endsWithFinalPeriod = (value: string): boolean => value.trim().endsWith('.');

const endsWithFinalStop = (value: string): boolean => /[.?]$/.test(value.trim());

// A leaf already governed by a more specific name/path-based role above
// must not ALSO be judged by the generic "Label: {{value}}" value-shape
// check below — see that pattern's own doc comment for why.
const isGovernedByAnotherRole = (path: string): boolean => {
  const name = leafName(path);

  return (
    TITLE_KEYS.has(path) ||
    ERROR_KEY.test(name) ||
    PLACEHOLDER_KEY.test(name) ||
    MESSAGE_KEY.test(name) ||
    HINT_KEY.test(name) ||
    ERROR_TITLE_KEY.test(name) ||
    KIND_SUBTITLE_PATH.test(path)
  );
};

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

  it('never ends a *Placeholder value with a final "."', () => {
    const offenders = leaves
      .filter(({ path }) => PLACEHOLDER_KEY.test(leafName(path)))
      .filter(({ value }) => endsWithFinalPeriod(value));

    expect(offenders).toEqual([]);
  });

  it('always ends a *Message value with "." or "?"', () => {
    const offenders = leaves
      .filter(({ path }) => MESSAGE_KEY.test(leafName(path)))
      .filter(({ value }) => !endsWithFinalStop(value));

    expect(offenders).toEqual([]);
  });

  it('always ends a *Hint value with "."', () => {
    const offenders = leaves
      .filter(({ path }) => HINT_KEY.test(leafName(path)))
      .filter(({ value }) => !endsWithFinalPeriod(value));

    expect(offenders).toEqual([]);
  });

  it('always ends a kindSubtitle.* value with "."', () => {
    const offenders = leaves
      .filter(({ path }) => KIND_SUBTITLE_PATH.test(path))
      .filter(({ value }) => !endsWithFinalPeriod(value));

    expect(offenders).toEqual([]);
  });

  it('never ends an *ErrorTitle value with a final "."', () => {
    const offenders = leaves
      .filter(({ path }) => ERROR_TITLE_KEY.test(leafName(path)))
      .filter(({ value }) => endsWithFinalPeriod(value));

    expect(offenders).toEqual([]);
  });

  it('never ends a "Label: {{value}}"-shaped value with a final "." (the DECISION\'s one named exception aside)', () => {
    const offenders = leaves
      .filter(({ path }) => !isGovernedByAnotherRole(path))
      .filter(({ path, value }) => {
        const withoutTrailingPeriod = value.replace(/\.$/, '');

        return LABEL_VALUE_PATTERN.test(withoutTrailingPeriod) && endsWithFinalPeriod(value);
      })
      .filter(({ path }) => !LABEL_VALUE_ALLOWLIST.has(path));

    expect(offenders).toEqual([]);
  });

  it('covers a non-trivial number of keys in each checked role (the fixture is alive)', () => {
    const countFor = (matches: (path: string) => boolean): number =>
      leaves.filter(({ path }) => matches(path)).length;

    expect(countFor((path) => TITLE_KEYS.has(path))).toBeGreaterThan(10);
    expect(countFor((path) => ERROR_KEY.test(leafName(path)))).toBeGreaterThan(20);
    expect(countFor((path) => PLACEHOLDER_KEY.test(leafName(path)))).toBeGreaterThan(10);
    expect(countFor((path) => MESSAGE_KEY.test(leafName(path)))).toBeGreaterThan(5);
  });
});
