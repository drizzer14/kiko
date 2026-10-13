import { useState } from 'react';

import { ruleCategoryFor } from '../category-rule';

type UseCategoryPickParams = {
  description: string;
  setDescription: (description: string) => void;
  isEditing: boolean;
  categoryByNormalizedName: ReadonlyMap<string, string>;
};

// The picked category and the ways it gets set: an explicit pick, and the
// name-rule auto-pick when the description settles.
export const useCategoryPick = ({
  description,
  setDescription,
  isEditing,
  categoryByNormalizedName,
}: UseCategoryPickParams) => {
  // The picked category key (a categories.key slug, lowercase). Null = no
  // category yet. Editing it ALWAYS propagates to every same-name transaction
  // via the override rule — there is no single-row-only category edit.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Whether the user has explicitly picked a category through the picker. Gates
  // the description-blur auto-pick: once the user chooses, a later matching
  // blur must never overwrite that choice.
  const [userPickedCategory, setUserPickedCategory] = useState(false);

  // An explicit category pick: record the choice AND flag it, so a later
  // description blur (the A1 auto-pick) never overwrites what the user chose.
  const selectCategory = (key: string): void => {
    setSelectedCategory(key);
    setUserPickedCategory(true);
  };

  // The ONE rule lookup: the category the name rules map a name to, or null.
  const categoryForName = (name: string): string | null =>
    ruleCategoryFor(name, categoryByNormalizedName);

  // A1's category auto-pick, factored into ONE surface both the description
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

    setSelectedCategory(categoryForName(name));
  };

  // The category Save acts on: the one the rules give the LIVE description when
  // nothing was picked and this is a create, else the committed pick. A nav-bar
  // Save does not end editing, so no description blur has re-seated the pick yet.
  const effectiveCategory =
    userPickedCategory || isEditing ? selectedCategory : categoryForName(description);

  // Commit the live description's rule category to the visible picker, so the
  // picker shows what Save validates and writes, as a blur would have left it.
  const settleCategory = (): void => {
    reseatCategoryFromName(description);
  };

  // A1: when the description SETTLES (blur, never a keystroke), re-seat the
  // category from the current field value through the shared surface above.
  const onDescriptionBlur = (): void => {
    reseatCategoryFromName(description);
  };

  // Tapping an inline suggestion fills the description verbatim AND re-fires
  // A1's rule lookup on that same value, so picking a known merchant name seats
  // its category exactly as a blur would — ONE coherent description-handling
  // surface, not two competing effects.
  const pickSuggestion = (suggestion: string): void => {
    setDescription(suggestion);
    reseatCategoryFromName(suggestion);
  };

  return {
    selectedCategory,
    effectiveCategory,
    settleCategory,
    setSelectedCategory,
    setUserPickedCategory,
    selectCategory,
    onDescriptionBlur,
    pickSuggestion,
  };
};
