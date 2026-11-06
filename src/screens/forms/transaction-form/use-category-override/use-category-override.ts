import { useState } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { transactionsRepo } from '@kiko/transactions/repo';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

import { type CategoryOverrideRequest, resolvePendingCategory } from '../category-rule';

type UseCategoryOverrideParams = {
  navigation: { goBack: () => void };
  editingId: string | null;
  categoryByKey: Parameters<typeof resolvePendingCategory>[1];
  buildApplyCategoryMessage: (category: string, name: string) => string;
  showSaveErrorAlert: () => void;
};

// The category-override confirmation's state and writes: the pending request
// (non-null while the themed confirm sheet is up, carrying the affected name,
// the picked category key and the row the save wrote; null when no confirmation
// is in flight) and the sheet's actions: Apply, Just for this one, and the prefix offer's preview
// and confirm.
export const useCategoryOverride = ({
  navigation,
  editingId,
  categoryByKey,
  buildApplyCategoryMessage,
  showSaveErrorAlert,
}: UseCategoryOverrideParams) => {
  const [pendingOverride, setPendingOverride] = useState<CategoryOverrideRequest | null>(null);
  const [prefixPreview, setPrefixPreview] = useState<{ count: number; names: string[] } | null>(
    null,
  );

  // A category change offers to become a name rule for every same-name
  // transaction (and for future imports), so surface the blast radius in a
  // themed confirm modal before writing the rule. Every path returns to the
  // list (the manual write, if any, has already been done); only "Apply" and
  // the prefix confirm also write a name rule, and each hands the rule the row
  // the save wrote so that row follows the rule rather than staying a hand pick.
  const applyOverride = async (): Promise<void> => {
    if (pendingOverride === null) {
      return;
    }

    try {
      await categoryRulesRepo.applyNameRule({
        name: pendingOverride.name,
        category: pendingOverride.category,
        sourceTransactionId: pendingOverride.sourceTransactionId,
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

  // The name's text before a store number: the "starts with" offer. It only previews (reads); the
  // rule is written by the confirm alone.
  const prefixOffer =
    foldMap(maybe(pendingOverride), (override) => merchantNameOf(override.name).prefix) ?? null;

  const offerPrefix = async (): Promise<void> => {
    if (pendingOverride === null || prefixOffer === null) {
      return;
    }

    try {
      setPrefixPreview(
        await categoryRulesRepo.previewNameRule({
          text: prefixOffer,
          kind: 'nameStartsWith',
          category: pendingOverride.category,
          sourceTransactionId: pendingOverride.sourceTransactionId,
        }),
      );
    } catch {
      showSaveErrorAlert();
    }
  };

  const { onPress: onOfferPrefix, isSubmitting: isOfferingPrefix } = useSubmitOnce(offerPrefix);

  const applyPrefix = async (): Promise<void> => {
    if (pendingOverride === null || prefixOffer === null) {
      return;
    }

    try {
      await categoryRulesRepo.applyNameRule({
        name: prefixOffer,
        kind: 'nameStartsWith',
        category: pendingOverride.category,
        sourceTransactionId: pendingOverride.sourceTransactionId,
      });
      navigation.goBack();
    } catch {
      showSaveErrorAlert();
    }
  };

  const { onPress: onApplyPrefix, isSubmitting: isApplyingPrefix } = useSubmitOnce(applyPrefix);

  // Any sheet read or write in flight: the sheet stays up (a scrim/back dismiss or
  // Cancel closes nothing) until it is done and a write's own `goBack` runs.
  const isOverrideWriting = [
    isApplyingOverride,
    isApplyingOverrideOne,
    isOfferingPrefix,
    isApplyingPrefix,
  ].includes(true);

  const onBackFromPrefix = (): void => {
    if (isOverrideWriting) {
      return;
    }

    setPrefixPreview(null);
  };

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
    prefixOffer,
    prefixPreview,
    onOfferPrefix,
    isOfferingPrefix,
    onBackFromPrefix,
    onApplyPrefix,
    isApplyingPrefix,
  };
};
