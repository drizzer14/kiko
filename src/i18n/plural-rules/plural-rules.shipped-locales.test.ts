import { i18n } from '../init';
import { appLanguages } from '../device-language';

import { installPluralRulesFallback } from './plural-rules';

const nodePluralRules = Intl.PluralRules;

// Every catalogue the app bundles and every language it can pick, so a
// locale added in either place is checked here.
const shippedLocales = [
  ...new Set([...Object.keys(i18n.options.resources ?? {}), ...appLanguages]),
].sort();

const counts = [
  ...Array.from({ length: 201 }, (_, index) => index),
  0.5,
  1.5,
  2.1,
  4.75,
  5.25,
  11.5,
  21.3,
  100.01,
  -1,
  -2,
  -5,
  -11,
  -21,
  -1.5,
];

const sorted = (categories: readonly string[]): string[] => [...categories].sort();

// Node carries the CLDR plural data that Hermes on iOS lacks, so the fallback
// is proven equal to it for each shipped locale: a locale shipped without its
// own rule in the fallback fails here.
describe.each(shippedLocales)('the Intl.PluralRules fallback for %s', (locale) => {
  const cldr = new nodePluralRules(locale);
  let fallback: Intl.PluralRules;

  beforeAll(() => {
    Reflect.deleteProperty(Intl, 'PluralRules');
    installPluralRulesFallback();
    fallback = new Intl.PluralRules(locale);
    Object.defineProperty(Intl, 'PluralRules', {
      value: nodePluralRules,
      writable: true,
      configurable: true,
    });
  });

  it('has the CLDR plural categories', () => {
    expect(sorted(fallback.resolvedOptions().pluralCategories)).toEqual(
      sorted(cldr.resolvedOptions().pluralCategories),
    );
  });

  it.each(counts)('selects the CLDR category for %p', (count) => {
    expect(fallback.select(count)).toBe(cldr.select(count));
  });
});

it('ships at least the two languages the app is written in', () => {
  expect(shippedLocales).toEqual(expect.arrayContaining(['en', 'uk']));
});
