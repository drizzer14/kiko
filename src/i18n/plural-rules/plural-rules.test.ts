import { installPluralRulesFallback, ukrainianCardinalCategory } from './plural-rules';

const nodePluralRules = Intl.PluralRules;

const restoreNodePluralRules = (): void => {
  Object.defineProperty(Intl, 'PluralRules', {
    value: nodePluralRules,
    writable: true,
    configurable: true,
  });
};

const wholeCounts = Array.from({ length: 201 }, (_, index) => index);
const otherCounts = [-1, -2, -5, -11, -21, 0.5, 1.5, 2.1, 4.75, 5.25, 11.5, 21.3, 100.01];

describe('ukrainianCardinalCategory', () => {
  // Node's Intl.PluralRules carries the CLDR data the device lacks, so the
  // hand-written rule is proven equal to it here.
  const cldr = new Intl.PluralRules('uk');

  it.each([...wholeCounts, ...otherCounts])('matches CLDR for %p', (count) => {
    expect(ukrainianCardinalCategory(count)).toBe(cldr.select(count));
  });
});

describe('installPluralRulesFallback', () => {
  afterEach(restoreNodePluralRules);

  it('leaves a present Intl.PluralRules untouched', () => {
    installPluralRulesFallback();

    expect(Intl.PluralRules).toBe(nodePluralRules);
  });

  describe('without Intl.PluralRules', () => {
    beforeEach(() => {
      Reflect.deleteProperty(Intl, 'PluralRules');
      installPluralRulesFallback();
    });

    it('selects the Ukrainian cardinal categories', () => {
      const rules = new Intl.PluralRules('uk', { type: 'cardinal' });

      expect([1, 2, 5, 1.5].map((count) => rules.select(count))).toEqual([
        'one',
        'few',
        'many',
        'other',
      ]);
      expect(rules.resolvedOptions().pluralCategories).toEqual(['one', 'few', 'many', 'other']);
    });

    it('selects one or other for every other language', () => {
      const rules = new Intl.PluralRules('en', { type: 'cardinal' });

      expect([0, 1, 2, 21].map((count) => rules.select(count))).toEqual([
        'other',
        'one',
        'other',
        'other',
      ]);
      expect(rules.resolvedOptions().pluralCategories).toEqual(['one', 'other']);
    });

    it('selects one or other for Ukrainian ordinals', () => {
      const rules = new Intl.PluralRules('uk', { type: 'ordinal' });

      expect([1, 2].map((count) => rules.select(count))).toEqual(['one', 'other']);
      expect(rules.resolvedOptions().pluralCategories).toEqual(['one', 'other']);
    });
  });
});
