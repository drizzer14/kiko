import { i18n } from '@kiko/i18n/init';
import { act } from '@testing-library/react-native';

import { categoryDeleteNoticeOf } from './delete-notice';

const mockCountRulesOfCategory = jest.fn<Promise<number>, [string]>();

jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    countRulesOfCategory: (key: string) => mockCountRulesOfCategory(key),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('categoryDeleteNoticeOf', () => {
  it('says nothing for a category without rules', async () => {
    mockCountRulesOfCategory.mockResolvedValue(0);

    expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBeUndefined();
  });

  it('names the rules that go with the category, counted for its key', async () => {
    mockCountRulesOfCategory.mockResolvedValue(3);

    expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
      'Its 3 rules will be deleted too.',
    );
    expect(mockCountRulesOfCategory).toHaveBeenCalledWith('groceries');
  });

  it('uses the singular for one rule', async () => {
    mockCountRulesOfCategory.mockResolvedValue(1);

    expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
      'Its 1 rule will be deleted too.',
    );
  });

  it('still says the rules go too when their count cannot be read', async () => {
    mockCountRulesOfCategory.mockRejectedValue(new Error('read failed'));

    expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
      'Its rules will be deleted too.',
    );
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

    it.each([
      [1, 'Її 1 правило теж буде видалено.'],
      [2, 'Її 2 правила теж буде видалено.'],
      [5, 'Її 5 правил теж буде видалено.'],
      [21, 'Її 21 правило теж буде видалено.'],
    ])('says %i rules in the right plural form', async (count, expected) => {
      mockCountRulesOfCategory.mockResolvedValue(count);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(expected);
    });

    it('still says the rules go too when their count cannot be read', async () => {
      mockCountRulesOfCategory.mockRejectedValue(new Error('read failed'));

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Її правила теж буде видалено.',
      );
    });
  });
});
