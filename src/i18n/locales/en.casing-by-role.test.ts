// src/i18n/locales/en.casing-by-role.test.ts
//
// One casing rule per UI role:
//
//   Title Case — screen/navigation titles, section headings, sheet/modal
//   titles.
//   Sentence case — everything else: buttons, chips/segments, menu items,
//   field labels, captions, placeholders, errors, hints.
//
// Every leaf string in the `en` catalog is walked at runtime (not the
// source text — a violation buried behind an interpolation or a computed
// value is caught the same as a plain literal) and assigned to one of the
// two buckets.
//
// The Title Case bucket is an EXPLICIT key list (`TITLE_KEYS`, now shared
// via `./title-keys.ts` with `en.final-stop-by-role.test.ts` — the
// full-stop invariant, since a title/heading/sheet-title key is ALSO one of
// the no-final-"." roles), not a key-NAME pattern (`/Title$/`, `/Heading$/`,
// etc.). A pattern is a blind spot in the direction
// that matters: a future BUTTON or LABEL key that happens to end in
// `Title`/`Heading` would silently land in the Title bucket and never get
// checked for sentence case (this file already needed one `ErrorTitle`
// carve-out because a `*Title` key turned out NOT to be a title — see
// `settings.dataExport.errorTitle`, an `Alert.alert` title, i.e. an error).
// Every key NOT in `TITLE_KEYS` is checked as sentence case, including one
// that matches a `Title`/`Heading`-looking name — so a new title key fails
// this test the moment it renders wrong, until it is added to `TITLE_KEYS`
// on purpose. Every entry in `TITLE_KEYS` is verified by call site (a nav
// `options.title`/`navigation.setOptions`, a `variant="heading"` `Text`, or
// a `BottomSheet`/`ConfirmSheet` title/header prop), except the three
// Settings-root row labels (`help.rowLabel`, `settings.dataExport.rowLabel`,
// `settings.dataImport.rowLabel`), which are listed by user ruling and are
// not headings at any call site.
//
// `columnMapping.rawPreview` and `forms.transaction.applyCategoryToAll`
// look like ordinary sentence-case keys by name, but both render through
// `<Text variant="heading">` as a section/sheet header (confirmed by call
// site) and so are Title-role despite the key name.
//
// `currencyNames.*` and `language.*` are official currency/language names
// (proper nouns, e.g. "Ukrainian Hryvnia", "English") — exempt from the
// role check entirely, the same way `settings.footer.copyrightHolder` (a
// person's name) is exempt.
import { en } from './en';
import { TITLE_KEYS } from './title-keys';
import { flattenCatalog } from './flatten-catalog';

// Proper nouns / brand names / acronym-like words kept capitalized wherever
// they appear, per the DECISION's keep-list ("Keep: proper nouns and brand
// names ... acronyms"). `Settings` covers "iOS Settings" (the OS app);
// `Ukrainian` is a demonym (a proper adjective — English capitalizes these
// regardless of position, not a casing choice).
const PROPER_NOUNS = new Set([
  'Kiko',
  'Monobank',
  'Binance',
  'Bitcoin',
  'Diia',
  'Apple',
  'Keychain',
  'Face',
  'Settings',
  'Ukrainian',
  'Europe',
]);

// A capital letter that stands for a number the user picks ("Every N days"),
// written the way a count placeholder is conventionally written.
const NUMBER_PLACEHOLDER_LETTERS = new Set(['N']);

const EXEMPT_KEY_PREFIXES = ['currencyNames.', 'language.'];
const EXEMPT_KEYS = new Set(['settings.footer.copyrightHolder']);

const isExempt = (key: string): boolean =>
  EXEMPT_KEYS.has(key) || EXEMPT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

const isTitleRole = (key: string): boolean => TITLE_KEYS.has(key);

const SMALL_TITLE_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'and',
  'or',
  'with',
  'is',
  'was',
  'your',
  'this',
  'at',
  'by',
  'as',
  'it',
  'its',
  'from',
  'no',
]);

// Real (letter-only) word tokens, with `{{interpolation}}` blanked out so it
// never counts as a word.
const realWords = (value: string): string[] => {
  const stripped = value.replace(/\{\{[^}]*\}\}/g, (match) => ' '.repeat(match.length));

  return stripped.match(/[A-Za-z']+/g) ?? [];
};

// Title Case: every real word capitalized, except a small connector word
// (never the first word).
const titleCaseViolations = (value: string): string[] => {
  const words = realWords(value);

  if (words.length < 2) {
    return [];
  }

  return words.filter((word, index) => {
    if (index === 0) {
      return !/^[A-Z]/.test(word);
    }

    if (SMALL_TITLE_WORDS.has(word.toLowerCase())) {
      return false;
    }

    return !/^[A-Z]/.test(word);
  });
};

// The en value of every Title-role key. A sentence may quote one of them whole ("Export Data",
// a Settings row that is Title Case by ruling), so that exact text is not a casing slip.
const TITLE_VALUES = new Set(
  flattenCatalog(en)
    .filter(({ path }) => TITLE_KEYS.has(path))
    .map(({ value }) => value),
);

// Blanks every `"…"` span whose text is exactly a Title-role value, quotes included, so the words
// inside are not read as sentence text. A span that only contains one, or any other capitalized
// phrase, stays and is checked.
const withoutQuotedTitles = (value: string): string =>
  value.replace(/"([^"]*)"/g, (span, inner: string) =>
    TITLE_VALUES.has(inner) ? ' '.repeat(span.length) : span,
  );

// Sentence case: a word may be capitalized only at the very start of the
// string, at the start of a later sentence (after `. ! ? : — -  " “`), when it
// is an acronym (starts with 2+ uppercase letters/digits, e.g. "ISIN's"),
// or when it is on the proper-noun allow-list above.
const sentenceCaseViolations = (value: string): string[] => {
  const stripped = withoutQuotedTitles(value).replace(/\{\{[^}]*\}\}/g, (match) =>
    ' '.repeat(match.length),
  );
  const wordPattern = /[A-Za-z']+/g;
  const violations: string[] = [];
  let match: RegExpExecArray | null = wordPattern.exec(stripped);

  while (match !== null) {
    const word = match[0];
    let cursor = match.index - 1;

    while (cursor >= 0 && /\s/.test(stripped[cursor] ?? '')) {
      cursor -= 1;
    }

    const previousChar = cursor >= 0 ? stripped[cursor] : null;
    const isSentenceStart = previousChar === null || '.!?:—-"“'.includes(previousChar);
    const isCapitalized = /^[A-Z]/.test(word);
    const isAcronymLike = /^[A-Z0-9]{2,}/.test(word);

    const isKeptAsWritten = PROPER_NOUNS.has(word) || NUMBER_PLACEHOLDER_LETTERS.has(word);

    if (isCapitalized && !isSentenceStart && !isAcronymLike && !isKeptAsWritten) {
      violations.push(word);
    }

    match = wordPattern.exec(stripped);
  }

  return violations;
};

describe('a sentence that quotes a Title-role value', () => {
  it('accepts a quoted span that is exactly the value of a Title-role key', () => {
    expect(sentenceCaseViolations('Open the "Settings" tab, then tap "Export Data".')).toEqual([]);
    expect(sentenceCaseViolations('Tap "Import Data", then "Replace data".')).toEqual([]);
  });

  it('still rejects a quoted capitalized phrase that is no Title-role value', () => {
    expect(sentenceCaseViolations('Tap "Export Stuff" to continue.')).toEqual(['Stuff']);
  });

  it('still rejects a capital outside the quoted Title-role value', () => {
    expect(sentenceCaseViolations('Tap "Export Data" And continue.')).toEqual(['And']);
    expect(sentenceCaseViolations('Tap "Export Data" or Export Data.')).toEqual(['Export', 'Data']);
  });

  it('rejects a span that only contains a Title-role value', () => {
    expect(sentenceCaseViolations('Tap "Export Data Now" to continue.')).toEqual(['Data', 'Now']);
  });
});

describe('en catalog casing follows one rule per UI role', () => {
  const allLeaves = flattenCatalog(en).filter(({ path }) => !isExempt(path));
  const titleRoleLeaves = allLeaves.filter(({ path }) => isTitleRole(path));
  const sentenceRoleLeaves = allLeaves.filter(({ path }) => !isTitleRole(path));

  it('covers a non-trivial number of keys in each role (the fixture is alive)', () => {
    expect(titleRoleLeaves.length).toBeGreaterThan(10);
    expect(sentenceRoleLeaves.length).toBeGreaterThan(100);
  });

  it('every TITLE_KEYS entry still exists in the catalog (no stale/renamed key)', () => {
    const catalogPaths = new Set(flattenCatalog(en).map(({ path }) => path));
    const staleTitleKeys = [...TITLE_KEYS].filter((key) => !catalogPaths.has(key));

    expect(staleTitleKeys).toEqual([]);
  });

  it('renders every screen/nav title, section heading, and sheet/modal title in Title Case', () => {
    const offenders = titleRoleLeaves
      .map(({ path, value }) => [path, value, titleCaseViolations(value)] as const)
      .filter(([, , violations]) => violations.length > 0);

    expect(offenders).toEqual([]);
  });

  it('keeps every Help topic row label in sentence case, outside TITLE_KEYS', () => {
    const topicRowLabels = flattenCatalog(en).filter(({ path }) =>
      /^help\.topics\.[^.]+\.rowLabel$/.test(path),
    );

    expect(topicRowLabels.length).toBeGreaterThan(0);

    const listedAsTitles = topicRowLabels.filter(({ path }) => TITLE_KEYS.has(path));
    const notSentenceCase = topicRowLabels.filter(
      ({ value }) => sentenceCaseViolations(value).length > 0,
    );

    expect(listedAsTitles).toEqual([]);
    expect(notSentenceCase).toEqual([]);
  });

  it('renders every button, chip/segment, menu item, field label, caption, placeholder, error, and hint in sentence case', () => {
    const offenders = sentenceRoleLeaves
      .map(({ path, value }) => [path, value, sentenceCaseViolations(value)] as const)
      .filter(([, , violations]) => violations.length > 0);

    expect(offenders).toEqual([]);
  });
});
