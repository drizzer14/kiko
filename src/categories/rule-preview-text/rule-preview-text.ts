import type { TFunction } from 'i18next';

export const NAMES_SHOWN = 5;

// The names join by a comma, never `Intl.ListFormat`, which Hermes may lack. The rest of the names
// is part of the same phrase, so each language places its own joining word and punctuation.
const namesTextOf = (names: readonly string[], t: TFunction): string => {
  const shown = names
    .slice(0, NAMES_SHOWN)
    .map((name) => t('common.listedName', { name }))
    .join(', ');
  const hiddenCount = names.length - NAMES_SHOWN;

  if (hiddenCount > 0) {
    return t('categoryRulePreview.namesAndMore', { names: shown, count: hiddenCount });
  }

  return shown;
};

export const ruleMoveMessage = (
  preview: { count: number; names: readonly string[] },
  categoryTitle: string,
  t: TFunction,
): string => {
  if (preview.count === 0) {
    return t('categoryRulePreview.noRowsMessage', { category: categoryTitle });
  }

  return t('categoryRulePreview.moveMessage', {
    count: preview.count,
    category: categoryTitle,
    names: namesTextOf(preview.names, t),
  });
};
