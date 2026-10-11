import { useLiveQuery } from '@kiko/db';
import { useMemo, useState } from 'react';
import { prepareRules } from '@kiko/categories/category-rules';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import { nameOnlySubject, ruleCategoryFor } from '../category-rule';

type UseCategoryPickParams = {
  description: string;
  setDescription: (description: string) => void;
  isEditing: boolean;
};

// The picked category and the ways it gets set: an explicit pick, and the
// name-rule auto-pick when the description settles.
export const useCategoryPick = ({
  description,
  setDescription,
  isEditing,
}: UseCategoryPickParams) => {
  // The category rules: subscribed once and prepared once per change, so a create can pre-select
  // a category from the settled description on blur. Matching is JS-normalized (never SQL),
  // mirroring the sync insert path.
  const { data: rules } = useLiveQuery(categoryRulesRepo.allQuery(), ['category_rules']);
  const preparedRules = useMemo(() => prepareRules(rules), [rules]);
  // The picked category key (a categories.key slug, lowercase). Null = no
  // category yet. Editing it ALWAYS propagates to every same-name transaction
  // via the name rule — there is no single-row-only category edit.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Whether the user has explicitly picked a category through the picker. Gates
  // the description-blur auto-pick: once the user chooses, a later matching
  // blur must never overwrite that choice.
  const [userPickedCategory, setUserPickedCategory] = useState(false);

  // An explicit category pick: record the choice AND flag it, so a later
  // description blur (the category auto-pick) never overwrites what the user chose.
  const selectCategory = (key: string): void => {
    setSelectedCategory(key);
    setUserPickedCategory(true);
  };

  // The category auto-pick, factored into ONE surface both the description
  // blur AND the suggestion tap route through, so the two never stack a
  // second independent description effect. Given a settled name and no explicit
  // user pick, pre-select the category the existing name rules map that name to;
  // a name matching no rule yields null, which clears any prior auto-pick so
  // Save's create-time category requirement re-engages honestly. Only fires on a
  // create — an edit hydrates its own stored category and must not be re-derived
  // from the name. Takes the name explicitly (not the `description` state) so the
  // suggestion tap can seat from the just-picked value before its `setDescription`
  // has flushed.
  const reseatCategoryFromName = (name: string): void => {
    if (userPickedCategory || isEditing) {
      return;
    }

    setSelectedCategory(ruleCategoryFor(nameOnlySubject(name), preparedRules));
  };

  // When the description SETTLES (blur, never a keystroke), re-seat the
  // category from the current field value through the shared surface above.
  const onDescriptionBlur = (): void => {
    reseatCategoryFromName(description);
  };

  // Tapping an inline suggestion fills the description verbatim AND re-fires
  // the rule lookup on that same value, so picking a known merchant name seats
  // its category exactly as a blur would — ONE coherent description-handling
  // surface, not two competing effects.
  const pickSuggestion = (suggestion: string): void => {
    setDescription(suggestion);
    reseatCategoryFromName(suggestion);
  };

  return {
    selectedCategory,
    setSelectedCategory,
    setUserPickedCategory,
    selectCategory,
    onDescriptionBlur,
    pickSuggestion,
  };
};
