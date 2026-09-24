// src/i18n/locales/en.casing-by-role.test.ts
//
// One casing rule per UI role (CASE track, 2026-09-24 — the binding brief
// lives in .superpowers/sdd/shares-property-metals-debts/case-measure.md):
//
//   Title Case — screen/navigation titles, section headings, sheet/modal
//   titles.
//   Sentence case — everything else: buttons, chips/segments, menu items,
//   field labels, captions, placeholders, errors, hints.
//
// Every leaf string in the `en` catalog is walked at runtime (not the
// source text — a violation buried behind an interpolation or a computed
// value is caught the same as a plain literal) and assigned to one of the
// two buckets by its KEY, via the same call-site-verified patterns used to
// fix the catalog (see the case-measure doc): a key ending in `Title` or
// `Heading`, whose last segment is `title` or `heading`, or that lives
// under `columnMapping.section*`, is a Title Case role; a small explicit
// list covers the handful of heading/sheet-title keys that don't follow
// that naming convention (verified by call site — each renders through
// `variant="heading"`, a `BottomSheet`/`ConfirmSheet` title, or a nav
// `options.title`). Every other key defaults to sentence case — the
// majority role per the DECISION above, so an unrecognized future key is
// checked against it rather than silently skipped.
//
// A key ending `ErrorTitle` is carved OUT of the Title bucket on purpose:
// it is an `Alert.alert` title, i.e. an error, not a screen/sheet title
// (`settings.dataExport.errorTitle` -> "Export failed", not "Export
// Failed") — verified by call site, not by assumption from the key name.
//
// `columnMapping.rawPreview` and `forms.transaction.applyCategoryToAll`
// look like ordinary sentence-case keys by name, but both render through
// `<Text variant="heading">` as a section/sheet header (confirmed by call
// site) and so are explicitly Title-role despite the key name.
//
// `currencyNames.*` and `language.*` are official currency/language names
// (proper nouns, e.g. "Ukrainian Hryvnia", "English") — exempt from the
// role check entirely, the same way `settings.footer.copyrightHolder` (a
// person's name) is exempt.
import { en } from './en';

type Leaf = { path: string; value: string };

const leaves = (object: unknown, prefix = ''): Leaf[] => {
  if (typeof object === 'string') {
    return [{ path: prefix, value: object }];
  }

  if (object !== null && typeof object === 'object') {
    return Object.entries(object as Record<string, unknown>).flatMap(([key, value]) =>
      leaves(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  return [];
};

// Proper nouns / brand names / acronym-like words kept capitalized wherever
// they appear, per the DECISION's keep-list ("Keep: proper nouns and brand
// names ... acronyms"). `Settings` covers "iOS Settings" (the OS app);
// `Ukrainian` is a demonym (a proper adjective — English capitalizes these
// regardless of position, not a casing choice).
const PROPER_NOUNS = new Set([
  'Kiko',
  'Monobank',
  'Binance',
  'Diia',
  'Apple',
  'Keychain',
  'Face',
  'Settings',
  'Ukrainian',
]);

const EXEMPT_KEY_PREFIXES = ['currencyNames.', 'language.'];
const EXEMPT_KEYS = new Set(['settings.footer.copyrightHolder']);

const TITLE_KEY_PATTERNS = [/\.title$/i, /\.heading$/i, /Heading$/, /^columnMapping\.section/];
const TITLE_KEY_SUFFIX = /Title$/;
const TITLE_KEY_SUFFIX_EXCLUDE = /ErrorTitle$/i; // an Alert title is an error, not a screen/sheet title
const TITLE_KEY_EXPLICIT = new Set([
  'columnMapping.rawPreview',
  'forms.transaction.applyCategoryToAll',
  'statistics.accountContribution',
  'statistics.byType',
  'statistics.expensesByCategory',
  'statistics.netWorthOverTime',
  'statistics.spendingTrendByCategory',
]);

const isExempt = (key: string): boolean =>
  EXEMPT_KEYS.has(key) || EXEMPT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

const isTitleRole = (key: string): boolean =>
  TITLE_KEY_EXPLICIT.has(key) ||
  TITLE_KEY_PATTERNS.some((pattern) => pattern.test(key)) ||
  (TITLE_KEY_SUFFIX.test(key) && !TITLE_KEY_SUFFIX_EXCLUDE.test(key));

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

// Sentence case: a word may be capitalized only at the very start of the
// string, at the start of a later sentence (after `. ! ? : — -  "`), when it
// is an acronym (starts with 2+ uppercase letters/digits, e.g. "ISIN's"),
// or when it is on the proper-noun allow-list above.
const sentenceCaseViolations = (value: string): string[] => {
  const stripped = value.replace(/\{\{[^}]*\}\}/g, (match) => ' '.repeat(match.length));
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
    const isSentenceStart = previousChar === null || '.!?:—-"'.includes(previousChar);
    const isCapitalized = /^[A-Z]/.test(word);
    const isAcronymLike = /^[A-Z0-9]{2,}/.test(word);

    if (isCapitalized && !isSentenceStart && !isAcronymLike && !PROPER_NOUNS.has(word)) {
      violations.push(word);
    }

    match = wordPattern.exec(stripped);
  }

  return violations;
};

describe('en catalog casing follows one rule per UI role', () => {
  const allLeaves = leaves(en).filter(({ path }) => !isExempt(path));
  const titleRoleLeaves = allLeaves.filter(({ path }) => isTitleRole(path));
  const sentenceRoleLeaves = allLeaves.filter(({ path }) => !isTitleRole(path));

  it('covers a non-trivial number of keys in each role (the fixture is alive)', () => {
    expect(titleRoleLeaves.length).toBeGreaterThan(10);
    expect(sentenceRoleLeaves.length).toBeGreaterThan(100);
  });

  it('renders every screen/nav title, section heading, and sheet/modal title in Title Case', () => {
    const offenders = titleRoleLeaves
      .map(({ path, value }) => [path, value, titleCaseViolations(value)] as const)
      .filter(([, , violations]) => violations.length > 0);

    expect(offenders).toEqual([]);
  });

  it('renders every button, chip/segment, menu item, field label, caption, placeholder, error, and hint in sentence case', () => {
    const offenders = sentenceRoleLeaves
      .map(({ path, value }) => [path, value, sentenceCaseViolations(value)] as const)
      .filter(([, , violations]) => violations.length > 0);

    expect(offenders).toEqual([]);
  });

  // The Button no longer force-capitalizes, so each catalogue supplies its
  // own casing; a handful of concrete labels pinned directly as a readable
  // smoke test on top of the role sweep above.
  it('renders every button label in sentence case', () => {
    expect(en.accounts.addAccount).toBe('Add account');
    expect(en.forms.contribution.save).toBe('Save contribution');
    expect(en.common.save).toBe('Save');
    expect(en.common.cancel).toBe('Cancel');
    expect(en.common.delete).toBe('Delete');
  });
});
