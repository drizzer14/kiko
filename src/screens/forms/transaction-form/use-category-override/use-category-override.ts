import { useState } from 'react';
import { transactionsRepo } from '@kiko/transactions/repo';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import { resolvePendingCategory } from '../category-rule';

type UseCategoryOverrideParams = {
  navigation: { goBack: () => void };
  editingId: string | null;
  categoryByKey: Parameters<typeof resolvePendingCategory>[1];
  buildApplyCategoryMessage: (category: string, name: string) => string;
  showSaveErrorAlert: () => void;
};

// The category-override confirmation's state and writes: the pending request
// (non-null while the themed confirm sheet is up, carrying the affected name +
// picked category key; null when no confirmation is in flight) and the sheet's
// three actions.
export const useCategoryOverride = ({
  navigation,
  editingId,
  categoryByKey,
  buildApplyCategoryMessage,
  showSaveErrorAlert,
}: UseCategoryOverrideParams) => {
  const [pendingOverride, setPendingOverride] = useState<{
    name: string;
    category: string;
  } | null>(null);

  // Editing a category ALWAYS propagates to every same-name transaction (and to
  // future imports), so surface the blast radius in a themed confirm modal
  // before writing the rule. Both paths return to the list (the manual edit, if
  // any, has already been written); only "Apply" also writes the name rule.
  const applyOverride = async (): Promise<void> => {
    if (pendingOverride === null) {
      return;
    }

    try {
      await categoryRulesRepo.applyNameRule({
        name: pendingOverride.name,
        category: pendingOverride.category,
        sourceTransactionId: editingId,
      });
      navigation.goBack();
    } catch {
      showSaveErrorAlert();
    }
  };

  // A second `useSubmitOnce` instance, not the Save button's: this guards the
  // sheet's "Apply" write, an independent action reachable only once `save()`
  // has already returned (its own guard is idle again by then) and the sheet
  // is showing. Sharing one instance would conflate two different actions'
  // in-flight state under a single boolean — either action could wrongly
  // block the other — for no benefit, since neither button is ever pressed
  // while the other's write is in flight.
  const { onPress: onApplyOverride, isSubmitting: isApplyingOverride } =
    useSubmitOnce(applyOverride);

  // The "just for this one" path: persist the picked category on THIS row ONLY,
  // by id, then return to the list. Unlike `applyOverride` (the all-similar name
  // rule), nothing propagates to other same-name rows or to future imports —
  // `transactionsRepo.setCategory` rewrites the single target row's category and
  // nothing else. Only reachable in EDIT mode: `editingId` targets an existing
  // row, so the branch is guarded on it and the button is offered only when it
  // is present. A brand-new unsaved row has no id to target — and already
  // carries its category from `recordManual` — so this action is not offered
  // there.
  const applyOverrideOne = async (): Promise<void> => {
    if (pendingOverride === null || editingId === null) {
      return;
    }

    try {
      await transactionsRepo.setCategory({
        transactionId: editingId,
        category: pendingOverride.category,
      });
      navigation.goBack();
    } catch {
      showSaveErrorAlert();
    }
  };

  // A third independent `useSubmitOnce` instance, for the same reason
  // `onApplyOverride` has its own (see above): each sheet action's in-flight
  // state must stay separate so one never wrongly blocks another.
  const { onPress: onApplyOverrideOne, isSubmitting: isApplyingOverrideOne } =
    useSubmitOnce(applyOverrideOne);

  // Either sheet write in flight: the sheet stays up (a scrim/back dismiss or
  // Cancel closes nothing) until the write is done and its own `goBack` runs.
  const isOverrideWriting = [isApplyingOverride, isApplyingOverrideOne].includes(true);

  const cancelOverride = (): void => {
    if (isOverrideWriting) {
      return;
    }

    navigation.goBack();
  };

  // The picked category's resolved icon name + confirm copy for the sheet. The
  // sheet renders the glyph white (textPrimary), not its category color, by
  // design. Bundled by a module-level helper so the sheet gates on a single
  // nullable and the branch stays out of the hook body.
  const pendingCategory = resolvePendingCategory(
    pendingOverride,
    categoryByKey,
    buildApplyCategoryMessage,
  );
  const overrideMessage = pendingCategory?.message ?? '';

  return {
    pendingOverride,
    setPendingOverride,
    onApplyOverride,
    isApplyingOverride,
    onApplyOverrideOne,
    isApplyingOverrideOne,
    isOverrideWriting,
    cancelOverride,
    pendingCategory,
    overrideMessage,
  };
};
