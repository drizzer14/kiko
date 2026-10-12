import type { TFunction } from 'i18next';

import { TIME_OPERATOR_LABEL_KEYS, labelsOf } from './matcher-labels';

const translated = ((key: string) => `translated ${key}`) as TFunction;

describe('labelsOf', () => {
  it('translates the key of every member', () => {
    expect(labelsOf(TIME_OPERATOR_LABEL_KEYS, translated)).toEqual({
      before: 'translated ruleForm.before',
      after: 'translated ruleForm.after',
    });
  });
});
