import { useTranslation } from 'react-i18next';
import { useRef, type ReactElement } from 'react';
import { useRowMark } from '@kiko/recurring/use-row-mark';
import { ownIbansOf } from '@kiko/statistics/spending-ledger';
import { isOfferedForMark } from '@kiko/recurring/eligibility';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import { RECURRING_PERIODS } from '@kiko/recurring/recurring-periods';
import SelectField from '@kiko/design-system/components/select-field';

import { type MarkOption, writeMark } from './recurring-mark-field';
import type { RecurringMarkFieldProps } from './recurring-mark-field.props';

const OPTIONS: readonly MarkOption[] = ['none', ...RECURRING_PERIODS];

// The mark field of a stored debit: the period of the chain the row sits in, or "Not marked". A
// pick writes at once, as the loan link does, and touches neither Save nor the draft. It holds its
// own reads so the screen's cognitive budget does not grow, and states no value until they have
// settled, so a first read never shows a false "Not marked" that a tap would act on.
const RecurringMarkField = ({
  existing,
  holdings,
  accounts,
}: RecurringMarkFieldProps): ReactElement | null => {
  const { t } = useTranslation();
  const picked = useRef<MarkOption>('none');
  // The holding of the stored row, never the screen's `currency`, which follows the draft.
  const holding = holdings.find((candidate) => candidate.id === existing.holdingId);
  const account = accounts.find((candidate) => candidate.id === holding?.accountId);
  const currency = holding?.currency ?? 'UAH';
  const isOffered = isOfferedForMark(existing, holding, account, ownIbansOf(holdings), Date.now());
  const { chain, detectedPeriod, isReady } = useRowMark(
    existing,
    currency,
    isOffered,
    holdings,
    accounts,
  );

  const write = async (): Promise<void> => {
    try {
      await writeMark({ row: existing, currency, chain, option: picked.current });
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
    }
  };

  const { onPress: submitPick, isSubmitting } = useSubmitOnce(write);

  if (!isOffered) {
    return null;
  }

  const isSettled = isReady && !isSubmitting;

  return (
    <SelectField
      label={t('forms.transaction.markRecurring')}
      sheetTitle={t('forms.transaction.markRecurringSheetTitle')}
      options={OPTIONS}
      selected={isSettled ? (chain?.period ?? 'none') : null}
      onSelect={(option) => {
        picked.current = option;
        submitPick();
      }}
      labels={{
        none:
          detectedPeriod === null
            ? t('forms.transaction.notMarkedRecurring')
            : t(`forms.transaction.detectedRecurring.${detectedPeriod}`),
        weekly: t('forms.transaction.recurringPeriod.weekly'),
        monthly: t('forms.transaction.recurringPeriod.monthly'),
        everyThreeMonths: t('forms.transaction.recurringPeriod.everyThreeMonths'),
        everySixMonths: t('forms.transaction.recurringPeriod.everySixMonths'),
        yearly: t('forms.transaction.recurringPeriod.yearly'),
      }}
      emptyOption={detectedPeriod === null ? 'none' : undefined}
      placeholder=""
      disabled={!isSettled}
    />
  );
};

export default RecurringMarkField;
