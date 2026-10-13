import { i18n } from '@kiko/i18n/init';
import { act } from '@testing-library/react-native';

import { categoryDeleteNoticeOf } from './delete-notice';

const mockCountRulesOfCategory = jest.fn<Promise<number>, [string]>();
const mockCountReferencingCategory = jest.fn<Promise<number>, [string]>();

jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    countRulesOfCategory: (key: string) => mockCountRulesOfCategory(key),
  },
}));
jest.mock('@kiko/transaction-templates/repo', () => ({
  transactionTemplatesRepo: {
    countReferencingCategory: (key: string) => mockCountReferencingCategory(key),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCountRulesOfCategory.mockResolvedValue(0);
  mockCountReferencingCategory.mockResolvedValue(0);
});

describe('categoryDeleteNoticeOf', () => {
  it('says nothing for a category without rules or templates', async () => {
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

  describe('the templates the delete clears the category in', () => {
    it('names them, counted for the category key', async () => {
      mockCountReferencingCategory.mockResolvedValue(2);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'This also clears it in 2 templates.',
      );
      expect(mockCountReferencingCategory).toHaveBeenCalledWith('groceries');
    });

    it('uses the singular for one template', async () => {
      mockCountReferencingCategory.mockResolvedValue(1);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'This also clears it in 1 template.',
      );
    });

    it('follows the rules line, one line each', async () => {
      mockCountRulesOfCategory.mockResolvedValue(3);
      mockCountReferencingCategory.mockResolvedValue(2);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Its 3 rules will be deleted too.\nThis also clears it in 2 templates.',
      );
    });

    it('follows the rules line that has no count too', async () => {
      mockCountRulesOfCategory.mockRejectedValue(new Error('read failed'));
      mockCountReferencingCategory.mockResolvedValue(2);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Its rules will be deleted too.\nThis also clears it in 2 templates.',
      );
    });

    it('adds no line for a category no template names', async () => {
      mockCountRulesOfCategory.mockResolvedValue(3);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Its 3 rules will be deleted too.',
      );
    });

    it('still says the templates are cleared when the count cannot be read, after the rules line', async () => {
      mockCountRulesOfCategory.mockResolvedValue(3);
      mockCountReferencingCategory.mockRejectedValue(new Error('read failed'));

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Its 3 rules will be deleted too.\nThis also clears it in its templates.',
      );
    });

    it('still says the templates are cleared when the count cannot be read and there are no rules', async () => {
      mockCountReferencingCategory.mockRejectedValue(new Error('read failed'));

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'This also clears it in its templates.',
      );
    });

    it('shows both unknown lines, the rules first, when neither count can be read', async () => {
      mockCountRulesOfCategory.mockRejectedValue(new Error('read failed'));
      mockCountReferencingCategory.mockRejectedValue(new Error('read failed'));

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Its rules will be deleted too.\nThis also clears it in its templates.',
      );
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

    it.each([
      [1, 'Також її буде очищено в 1 шаблоні.'],
      [2, 'Також її буде очищено в 2 шаблонах.'],
      [5, 'Також її буде очищено в 5 шаблонах.'],
      [21, 'Також її буде очищено в 21 шаблоні.'],
    ])('says %i templates in the right plural form', async (count, expected) => {
      mockCountReferencingCategory.mockResolvedValue(count);

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(expected);
    });

    it('still says the templates are cleared when their count cannot be read', async () => {
      mockCountReferencingCategory.mockRejectedValue(new Error('read failed'));

      expect(await categoryDeleteNoticeOf('groceries', i18n.t)).toBe(
        'Також її буде очищено в шаблонах.',
      );
    });
  });
});
