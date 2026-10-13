import type { TFunction } from 'i18next';
import either, { bifoldMap } from 'fnts/either';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';
import { transactionTemplatesRepo } from '@kiko/transaction-templates/repo';

/**
 * The lines a category's delete confirm shows under its title, so the user reads what else the
 * delete takes before confirming. One line per kind of thing the delete touches, the rules first;
 * `undefined` when it touches nothing besides the category itself. The confirm's text is read
 * when the hold asks for it, so it names what is stored now. A rule count that cannot be read
 * still says the rules go too, without a number: the delete removes them whatever the read did.
 * A template count that cannot be read still says the templates are cleared, without a number,
 * for the same reason: the delete clears the category in its templates whatever the read did,
 * so the confirm still warns.
 */
export const categoryDeleteNoticeOf = async (
  key: string,
  t: TFunction,
): Promise<string | undefined> => {
  const [ruleCount, templateCount] = await Promise.all([
    either<Error, number>(() => categoryRulesRepo.countRulesOfCategory(key)),
    either<Error, number>(() => transactionTemplatesRepo.countReferencingCategory(key)),
  ]);
  const ruleLines = bifoldMap(
    ruleCount,
    () => [t('categories.deleteRulesNoticeUnknown')],
    (count) => (count > 0 ? [t('categories.deleteRulesNotice', { count })] : []),
  );
  const templateLines = bifoldMap(
    templateCount,
    () => [t('categories.deleteTemplatesUnknown')],
    (count) => (count > 0 ? [t('categories.deleteTemplates', { count })] : []),
  );
  const lines = [...ruleLines, ...templateLines];

  return lines.length > 0 ? lines.join('\n') : undefined;
};
