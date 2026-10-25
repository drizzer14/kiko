// src/i18n/locales/uk.catalog-rules.test.ts
//
// The uk catalogue rules, walked at RUNTIME over the nested `uk`
// object (not the source text), so a violation buried in a template literal
// or a computed value is caught the same as a plain string:
//
// (a) no ASCII apostrophe `'` and no right single quote U+2019 `’` between two Cyrillic
//     letters in any string value — Ukrainian text must use the U+02BC apostrophe `ʼ`.
// (b) the app name appears only as Cyrillic `Кіко`, never Latin `Kiko`, in
//     any string value.
// (c) a tap is asked for with «натиснути» only, never торкнутися, тапнути,
//     тицьнути or клацнути, in any string value.
// (d) a long press is asked for with «утримувати» only, never притиснути, затиснути or a
//     "довге натискання" / "тривале натискання" phrasing, in any string value.
import { uk } from './uk';
import { flattenCatalog } from './flatten-catalog';

const CYRILLIC = 'А-Яа-яЁёІіЇїЄєҐґ';
const ASCII_APOSTROPHE_IN_CYRILLIC_WORD = new RegExp(`[${CYRILLIC}]'[${CYRILLIC}]`);
const RIGHT_QUOTE_IN_CYRILLIC_WORD = new RegExp(`[${CYRILLIC}]’[${CYRILLIC}]`);
const LATIN_KIKO = /\bKiko\b/;
const OTHER_TAP_VERB = /торкн|тапн|тицн|клацн/i;
const OTHER_LONG_PRESS_VERB = /притисн|затисн|зажм|довг\S* (?:натиск|дотик|тап)|тривал\S* натиск/i;

describe('uk.ts catalogue rules', () => {
  it('never uses an ASCII apostrophe inside a Cyrillic word (must be U+02BC ʼ)', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) =>
      ASCII_APOSTROPHE_IN_CYRILLIC_WORD.test(value),
    );

    expect(offenders).toEqual([]);
  });

  it('never uses a right single quote (U+2019) inside a Cyrillic word (must be U+02BC ʼ)', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) =>
      RIGHT_QUOTE_IN_CYRILLIC_WORD.test(value),
    );

    expect(offenders).toEqual([]);
  });

  it('catches the U+2019 apostrophe in a Cyrillic word and lets U+02BC and a closing quote through', () => {
    expect(RIGHT_QUOTE_IN_CYRILLIC_WORD.test('пов’язаний')).toBe(true);
    expect(RIGHT_QUOTE_IN_CYRILLIC_WORD.test('повʼязаний')).toBe(false);
    expect(RIGHT_QUOTE_IN_CYRILLIC_WORD.test('слово’ слово')).toBe(false);
  });

  it('never spells the app name in Latin script ("Kiko") — must be Cyrillic "Кіко"', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) => LATIN_KIKO.test(value));

    expect(offenders).toEqual([]);
  });

  it('asks for a tap with the verb "натиснути" only', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) => OTHER_TAP_VERB.test(value));

    expect(offenders).toEqual([]);
  });

  it('asks for a long press with the verb "утримувати" only', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) => OTHER_LONG_PRESS_VERB.test(value));

    expect(offenders).toEqual([]);
  });

  // The rule above is only as good as its pattern; these phrasings are the ones it must catch.
  it.each([
    'Тривале натискання на рядок відкриває меню',
    'Меню відкривається тривалим натисканням',
    'Довге натискання на рядок',
    'Притисніть рядок',
    'Затисніть рядок',
  ])('catches the long press phrasing %s', (phrase) => {
    expect(OTHER_LONG_PRESS_VERB.test(phrase)).toBe(true);
  });

  it('lets the verb "утримувати" through', () => {
    expect(OTHER_LONG_PRESS_VERB.test('Утримуйте рядок, щоб відкрити меню')).toBe(false);
  });
});
