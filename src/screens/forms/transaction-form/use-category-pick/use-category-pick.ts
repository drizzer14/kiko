import { useLiveQuery } from '@kiko/db';
import { useMemo, useState, useCallback } from 'react';
import type { Currency } from '@kiko/currency/currency';
import { prepareRules } from '@kiko/categories/category-rules';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import { categoryForDraft } from '../category-rule';

type UseCategoryPickParams = {
  description: string;
  setDescription: (description: string) => void;
  isEditing: boolean;
  amount: string;
  time: number;
  mode: FormMode;
  // The picked holding's currency, null while no holding is picked.
  currency: Currency | null;
};

// The picked category and the ways it gets set: an explicit pick, and the
// rule pre-select from the whole draft.
export const useCategoryPick = ({
  description,
  setDescription,
  isEditing,
  amount,
  time,
  mode,
  currency,
}: UseCategoryPickParams) => {
  // The category rules: subscribed once and prepared once per change, so a create can pre-select
  // a category from its draft. Matching is JS-normalized (never SQL), mirroring the sync insert
  // path.
  const { data: rules } = useLiveQuery(categoryRulesRepo.allQuery(), ['category_rules']);
  const preparedRules = useMemo(() => prepareRules(rules), [rules]);
  // The category the user picked, or the one an edit or a Duplicate loaded (a categories.key
  // slug, lowercase). Null = none. A create without a pick shows what the rules give its draft
  // instead, so this holds nothing for it.
  const [storedCategory, setStoredCategory] = useState<string | null>(null);
  // Whether the user has explicitly picked a category through the picker. Gates
  // the pre-select: once the user chooses, a rule that starts to match later must
  // never replace that choice. A category an edit or a Duplicate seeds counts as a pick too.
  const [userPickedCategory, setUserPickedCategory] = useState(false);
  // The description the picker's pre-select reads, taken from the field when it settles (a blur,
  // a tapped suggestion, a Save), never from a keystroke: a category that flipped under the
  // user's typing would be noise. Every other part of the draft re-evaluates as it changes.
  const [settledDescription, setSettledDescription] = useState('');

  // An explicit category pick: record the choice AND flag it, so the pre-select
  // never replaces what the user chose.
  const selectCategory = (key: string): void => {
    setStoredCategory(key);
    setUserPickedCategory(true);
  };

  // The ONE way to seed a loaded draft (an edit, a Duplicate): a non-null category is held and
  // flagged as a pick in one step, so the picker and Save can never disagree about it, and the
  // description settles too, so a seeded draft without a category shows what its rules give it.
  // The setters are stable, so the function is too, and an effect may depend on it.
  const seedCategory = useCallback((category: string | null, seededDescription: string): void => {
    setStoredCategory(category);
    setUserPickedCategory(category !== null);
    setSettledDescription(seededDescription);
  }, []);

  // The ONE rule lookup: the category the rules give the draft with this description, or null.
  const categoryForDescription = (name: string): string | null =>
    categoryForDraft({ description: name, amount, time, mode, currency }, preparedRules);

  // A hand pick or an edit holds its own category; only a create without one is derived.
  const holdsOwnCategory = userPickedCategory || isEditing;

  // What the picker shows: the held category, or what the rules give the draft with its settled
  // description. A draft that stops matching therefore clears to none, so Save's create-time
  // category requirement re-engages honestly.
  const selectedCategory = holdsOwnCategory
    ? storedCategory
    : categoryForDescription(settledDescription);

  // The category Save acts on: the same, but for the LIVE description, because a nav-bar Save
  // does not end editing, so no blur has settled it yet.
  const effectiveCategory = holdsOwnCategory ? storedCategory : categoryForDescription(description);

  // The description SETTLES on a blur or a Save, so the picker shows what Save validates and
  // writes, as a blur would have left it.
  const settleDescription = (): void => {
    setSettledDescription(description);
  };

  // Tapping an inline suggestion fills the description verbatim AND settles it, so picking a
  // known merchant name seats its category exactly as a blur would: ONE coherent
  // description-handling surface, not two competing effects. Takes the suggestion directly
  // because `description` has not flushed yet.
  const pickSuggestion = (suggestion: string): void => {
    setDescription(suggestion);
    setSettledDescription(suggestion);
  };

  return {
    selectedCategory,
    effectiveCategory,
    userPickedCategory,
    seedCategory,
    selectCategory,
    settleDescription,
    pickSuggestion,
  };
};
