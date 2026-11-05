import { useTranslation } from 'react-i18next';
import { useCallback, useRef, useState } from 'react';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import type { ReviewGroup } from '@kiko/categories/category-rules';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { categoryRulesRepo } from '@kiko/categories/category-rules-repo';

type RuleChoice = { group: ReviewGroup; category: string };

type RulePreview = { count: number; names: string[] };

type PendingConfirm = RuleChoice & { preview: RulePreview };

// A job is the preview that decides between a write and a confirm, or the write itself once the
// user has confirmed.
type Job = RuleChoice & { confirmed: boolean };

// One pick on a review line, from the options sheet to the write. The write runs at once only when
// the preview moves exactly the rows the line lists; any other count asks first, because the rule
// also wins rows the list does not show.
export const useReviewActions = () => {
  const { t } = useTranslation();
  const [pickFor, setPickFor] = useState<ReviewGroup | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  // Apart from `pendingConfirm`, so a cancelled confirm keeps its text while its sheet fades out.
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // The pick waits here for the options sheet to finish closing: a confirm sheet asked to open
  // while another is still closing is dropped by an iOS Modal.
  const pickedRef = useRef<RuleChoice | null>(null);
  const jobRef = useRef<Job | null>(null);

  const run = useCallback(async (): Promise<void> => {
    const job = jobRef.current;

    jobRef.current = null;

    if (job === null) {
      return;
    }

    const { group, category } = job;
    const { kind, text } = group.rule;

    try {
      if (!job.confirmed) {
        const preview = await categoryRulesRepo.previewNameRule({
          text,
          kind,
          category,
          sourceTransactionId: null,
        });

        if (preview.count !== group.rowCount) {
          setPendingConfirm({ group, category, preview });
          setIsConfirmOpen(true);

          return;
        }
      }

      await categoryRulesRepo.applyNameRule({
        name: text,
        kind,
        category,
        sourceTransactionId: null,
      });
      setIsConfirmOpen(false);
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  }, [t]);
  const { onPress: submit, isSubmitting } = useSubmitOnce(run);

  const start = (job: Job): void => {
    jobRef.current = job;
    submit();
  };

  const pick = (category: string): void => {
    if (pickFor !== null) {
      pickedRef.current = { group: pickFor, category };
    }

    setPickFor(null);
  };

  const onOptionsClosed = (): void => {
    const picked = pickedRef.current;

    pickedRef.current = null;

    if (picked !== null) {
      start({ ...picked, confirmed: false });
    }
  };

  const confirm = (): void => {
    if (pendingConfirm !== null) {
      start({ group: pendingConfirm.group, category: pendingConfirm.category, confirmed: true });
    }
  };

  return {
    // A preview or a write is running: a pick on another line would be dropped without a word.
    isBusy: isSubmitting,
    isOptionsOpen: pickFor !== null,
    pendingConfirm,
    isConfirmOpen,
    choose: setPickFor,
    closeOptions: () => setPickFor(null),
    pick,
    onOptionsClosed,
    confirm,
    // A write that has started cannot be taken back, so a Cancel or scrim dismiss that lands
    // while it runs would close the sheet over rows that still move.
    cancelConfirm: () => {
      if (!isSubmitting) {
        setIsConfirmOpen(false);
      }
    },
  };
};
