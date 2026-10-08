// src/i18n/locales/uk.catalog-rules.test.ts
//
// The uk catalogue rules, walked at RUNTIME over the nested `uk`
// object (not the source text), so a violation buried in a template literal
// or a computed value is caught the same as a plain string:
//
// (a) no ASCII apostrophe `'` between two Cyrillic letters in any string
//     value — Ukrainian text must use the U+2019 apostrophe `’`.
// (b) the app name appears only as Cyrillic `Кіко`, never Latin `Kiko`, in
//     any string value.
import { uk } from './uk';
import { flattenCatalog } from './flatten-catalog';

const CYRILLIC = 'А-Яа-яЁёІіЇїЄєҐґ';
const ASCII_APOSTROPHE_IN_CYRILLIC_WORD = new RegExp(`[${CYRILLIC}]'[${CYRILLIC}]`);
const LATIN_KIKO = /\bKiko\b/;

describe('uk.ts catalogue rules', () => {
  it('never uses an ASCII apostrophe inside a Cyrillic word (must be U+2019 ’)', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) =>
      ASCII_APOSTROPHE_IN_CYRILLIC_WORD.test(value),
    );

    expect(offenders).toEqual([]);
  });

  it('never spells the app name in Latin script ("Kiko") — must be Cyrillic "Кіко"', () => {
    const offenders = flattenCatalog(uk).filter(({ value }) => LATIN_KIKO.test(value));

    expect(offenders).toEqual([]);
  });
});
