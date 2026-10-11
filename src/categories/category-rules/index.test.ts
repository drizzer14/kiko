import * as categoryRules from '.';

describe('category rules barrel', () => {
  it('exposes the rule module and nothing else', () => {
    expect(Object.keys(categoryRules).sort()).toEqual(
      [
        'candidateRules',
        'canEverMatch',
        'isRewriteEligible',
        'matcherSetKey',
        'matchesRule',
        'minuteOfDayOf',
        'parseRuleMatchers',
        'planRuleRewrite',
        'prepareRules',
        'subjectOfDraft',
        'subjectOfStoredRow',
        'validateRule',
        'winningRule',
      ].sort(),
    );
  });
});
