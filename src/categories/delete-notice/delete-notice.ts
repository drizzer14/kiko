import type { TFunction } from 'i18next';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

/**
 * The lines a category's delete confirm shows under its title, so the user reads what else the
 * delete takes before confirming. One line per kind of thing the delete removes; `undefined` when
 * it removes nothing besides the category itself. The confirm's text is read when the hold asks
 * for it, so it names what is stored now.
 */
export const categoryDeleteNoticeOf = async (
  key: string,
  t: TFunction,
): Promise<string | undefined> => {
  const ruleCount = await categoryRulesRepo.countRulesOfCategory(key);
  const lines = ruleCount > 0 ? [t('categories.deleteRulesNotice', { count: ruleCount })] : [];

  return lines.length > 0 ? lines.join('\n') : undefined;
};
