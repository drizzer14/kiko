import { resolveDefaultCategoryTitle } from './default-category-title';
import { i18n } from './index';

describe('resolveDefaultCategoryTitle', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates a seeded category still at its English seed title', async () => {
    await i18n.changeLanguage('uk');
    expect(resolveDefaultCategoryTitle('groceries', 'Groceries')).toBe('Продукти');
  });

  it('leaves a user-renamed category untouched in either language', async () => {
    await i18n.changeLanguage('uk');
    expect(resolveDefaultCategoryTitle('groceries', 'Магазин біля дому')).toBe('Магазин біля дому');
  });

  it('returns the English label under the English language', async () => {
    await i18n.changeLanguage('en');
    expect(resolveDefaultCategoryTitle('groceries', 'Groceries')).toBe('Groceries');
  });

  it('leaves an unknown key untouched', async () => {
    expect(resolveDefaultCategoryTitle('custom-key', 'My Category')).toBe('My Category');
  });
});
