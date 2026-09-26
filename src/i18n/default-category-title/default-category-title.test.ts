import { i18n } from '../init';

import { resolveDefaultCategoryTitle } from './default-category-title';

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

  // The eleventh default category, seeded by its own
  // later migration (0039) — must translate exactly like the original ten.
  it('translates the loan_interest seeded category (seeded by 0039)', async () => {
    await i18n.changeLanguage('uk');
    expect(resolveDefaultCategoryTitle('loan_interest', 'Loan interest')).toBe(
      'Відсотки за кредитом',
    );
  });
});
