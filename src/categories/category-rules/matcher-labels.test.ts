import { i18n } from '@kiko/i18n/init';
import type { TFunction } from 'i18next';
import { act } from '@testing-library/react-native';

import {
  AMOUNT_ROW_LABEL_KEYS,
  TIME_OPERATOR_LABEL_KEYS,
  TIME_ROW_LABEL_KEYS,
  labelsOf,
} from './matcher-labels';

const translated = ((key: string) => `translated ${key}`) as TFunction;

describe('labelsOf', () => {
  it('translates the key of every member', () => {
    expect(labelsOf(TIME_OPERATOR_LABEL_KEYS, translated)).toEqual({
      before: 'translated ruleForm.before',
      after: 'translated ruleForm.after',
    });
  });
});

describe('the row labels of a rule card', () => {
  it('reads each amount operator with its subject in English', () => {
    expect(labelsOf(AMOUNT_ROW_LABEL_KEYS, i18n.t)).toEqual({
      eq: 'Amount equals',
      gt: 'Amount is more than',
      gte: 'Amount is at least',
      lt: 'Amount is less than',
      lte: 'Amount is at most',
    });
  });

  it('reads each time operator with its subject in English', () => {
    expect(labelsOf(TIME_ROW_LABEL_KEYS, i18n.t)).toEqual({
      before: 'Time is before',
      after: 'Time is after',
    });
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('reads each amount operator with its subject in Ukrainian', () => {
      expect(labelsOf(AMOUNT_ROW_LABEL_KEYS, i18n.t)).toEqual({
        eq: 'Сума дорівнює',
        gt: 'Сума більша ніж',
        gte: 'Сума щонайменше',
        lt: 'Сума менша ніж',
        lte: 'Сума щонайбільше',
      });
    });

    it('reads each time operator with its subject in Ukrainian', () => {
      expect(labelsOf(TIME_ROW_LABEL_KEYS, i18n.t)).toEqual({
        before: 'Час до',
        after: 'Час після',
      });
    });
  });
});
