import { prepareRules } from './prepare-rules';
import { ruleRow } from './__fixtures__/rule-row';
import type { CategoryRuleMatcher } from './category-rules.d';

const nameIs = (text: string): CategoryRuleMatcher => ({ type: 'nameIs', text });

describe('the category of a prepared rule', () => {
  it('is the lowercase key, so a capitalized stored category reads as every other key', () => {
    const { ordered } = prepareRules([
      ruleRow({ id: 'capitalized', category: 'Groceries', matchers: [nameIs('silpo')] }),
    ]);

    expect(ordered.map((rule) => rule.category)).toEqual(['groceries']);
  });

  it('leaves a key that is already lowercase as it is', () => {
    const { ordered } = prepareRules([
      ruleRow({ id: 'lowercase', category: 'groceries', matchers: [nameIs('silpo')] }),
    ]);

    expect(ordered.map((rule) => rule.category)).toEqual(['groceries']);
  });
});
