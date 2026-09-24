// src/i18n/locales/uk.casing.test.ts
//
// Invariant: uk is sentence case EVERYWHERE (CASE track, 2026-09-24 —
// .superpowers/sdd/shares-property-metals-debts/case-measure.md's DECISION
// section) — unlike en, Ukrainian UI copy never switches to Title Case for a
// screen/nav title or a section heading. Walked at RUNTIME over the nested
// `uk` object (not the source text), so a violation buried in a template
// literal or a computed value is caught the same as a plain literal, the
// same approach `uk.catalog-rules.test.ts` uses for its own two invariants.
//
// A Cyrillic word capitalized somewhere other than the start of a sentence
// (the very start of the string, or right after `. ! ? : — -` or a quote) is
// a violation, UNLESS it is on the small proper-noun allow-list below —
// Кіко (the app), Дія/Дії (Diia, the government e-service brand), НБУ (the
// National Bank of Ukraine, an acronym), Налаштуваннях (the iOS Settings
// app name, inflected — kept per the DECISION's own callout), Українська
// (the language name). `currencyNames.*` (official currency names, e.g.
// "Долар США") and `settings.footer.copyrightHolder` (a person's name) are
// exempt entirely, the same proper-noun exemptions `en.casing-by-role.test.ts`
// makes.
import { uk } from './uk';
import { flattenCatalog } from './flatten-catalog';

const EXEMPT_KEY_PREFIXES = ['currencyNames.'];
const EXEMPT_KEYS = new Set(['settings.footer.copyrightHolder']);

const isExempt = (key: string): boolean =>
  EXEMPT_KEYS.has(key) || EXEMPT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

const PROPER_NOUNS = new Set(['Кіко', 'Дія', 'Дії', 'НБУ', 'Налаштуваннях', 'Українська']);

const CYRILLIC = 'А-ЯЁІЇЄҐа-яёіїєґ';
const CYRILLIC_WORD = new RegExp(`[${CYRILLIC}']+`, 'g');

const sentenceCaseViolations = (value: string): string[] => {
  const violations: string[] = [];
  let match: RegExpExecArray | null = CYRILLIC_WORD.exec(value);

  while (match !== null) {
    const word = match[0];
    let cursor = match.index - 1;

    while (cursor >= 0 && /\s/.test(value[cursor] ?? '')) {
      cursor -= 1;
    }

    const previousChar = cursor >= 0 ? value[cursor] : null;
    const isSentenceStart = previousChar === null || '.!?:—-"“”«»'.includes(previousChar);
    const isCapitalized = /^[А-ЯЁІЇЄҐ]/.test(word);

    if (isCapitalized && !isSentenceStart && !PROPER_NOUNS.has(word)) {
      violations.push(word);
    }

    match = CYRILLIC_WORD.exec(value);
  }

  return violations;
};

describe('uk catalog is sentence case everywhere', () => {
  it('never capitalizes a word outside a sentence start, or the proper-noun allow-list', () => {
    const offenders = flattenCatalog(uk)
      .filter(({ path }) => !isExempt(path))
      .map(({ path, value }) => [path, value, sentenceCaseViolations(value)] as const)
      .filter(([, , violations]) => violations.length > 0);

    expect(offenders).toEqual([]);
  });
});
