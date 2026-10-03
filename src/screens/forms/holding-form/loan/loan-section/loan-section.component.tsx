import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import DateField from '@kiko/screens/forms/date-field';
import TermField from '@kiko/screens/forms/term-field';
import TextField from '@kiko/design-system/components/text-field';
import FieldLabel from '@kiko/design-system/components/field-label';
import PaymentHoldingField from '@kiko/screens/forms/payment-holding-field';
import SegmentedControl from '@kiko/design-system/components/segmented-control';
import { loanSchedules, type LoanSchedule } from '@kiko/holdings/holding-metadata';

import type { LoanSectionProps } from './loan-section.props';

const loanScheduleLabels = (t: TFunction): Record<LoanSchedule, string> => ({
  annuity: t('forms.holding.loanSchedule.annuity'),
  differentiated: t('forms.holding.loanSchedule.differentiated'),
  none: t('forms.holding.loanSchedule.none'),
});

// The `loan` create/edit-form section: the loan kind is not here, it fills
// the form's Type slot (`LoanKindField`). The
// principal + start-date fields, the schedule SegmentedControl (one
// control type per kind of mode choice; the schedule DOES
// change the visible fields below it, so the Q2 tabs-vs-chips rule keeps it
// a SegmentedControl — the same reason the Bond form's ISIN/Manual toggle
// uses one), and the
// rate/term fields — hidden while `schedule` is `'none'` (an informal debt
// has no known rate/term). Unlike `PropertySection`/
// `MetalSection`, every field here is editable in BOTH create and edit mode
// (mirrors the term-deposit/bond forms, not the create-only-lot pattern) —
// there is no separate "first lot" this section seeds once and never
// revisits. Purely presentational: every piece of state and the validation
// reason live in `useLoanFields`; this component only renders what it is
// handed.
const LoanSection: FC<LoanSectionProps> = ({
  principal,
  onChangePrincipal,
  principalError,
  principalFieldRef,
  principalInputRef,
  currencySuffix,
  startDate,
  onChangeStartDate,
  startDateError,
  startDateFieldRef,
  schedule,
  onSelectSchedule,
  annualRatePct,
  onChangeAnnualRatePct,
  annualRatePctError,
  annualRatePctFieldRef,
  annualRatePctInputRef,
  term,
  onChangeTerm,
  termUnit,
  onSelectTermUnit,
  termError,
  termFieldRef,
  termInputRef,
  paymentHoldingId,
  onSelectPaymentHoldingId,
  paymentHoldingOptions,
  lenderName,
  onChangeLenderName,
  lenderIban,
  onChangeLenderIban,
}) => {
  const { t } = useTranslation();

  return (
    <Box gap={4}>
      <View ref={principalFieldRef}>
        <TextField
          label={t('forms.holding.loanPrincipal')}
          value={principal}
          onChangeText={onChangePrincipal}
          keyboardType="decimal-pad"
          placeholder={t('forms.holding.loanPrincipalPlaceholder')}
          suffix={currencySuffix}
          required
          error={principalError}
          inputRef={principalInputRef}
        />
      </View>

      <View ref={startDateFieldRef}>
        <DateField
          label={t('forms.holding.loanStartDate')}
          sheetTitle={t('forms.holding.loanStartDateSheetTitle')}
          value={startDate}
          onChange={onChangeStartDate}
          placeholder={t('forms.fields.selectDatePlaceholder')}
          required
          error={startDateError}
        />
      </View>

      <Box gap={1}>
        <FieldLabel label={t('forms.holding.loanScheduleLabel')} />

        <SegmentedControl<LoanSchedule>
          options={loanSchedules}
          selected={schedule}
          onSelect={onSelectSchedule}
          labels={loanScheduleLabels(t)}
          accessibilityLabel={t('forms.holding.loanScheduleLabel')}
        />
      </Box>

      {schedule !== 'none' && (
        <>
          <View ref={annualRatePctFieldRef}>
            <TextField
              label={t('forms.holding.annualRatePct')}
              value={annualRatePct}
              onChangeText={onChangeAnnualRatePct}
              keyboardType="decimal-pad"
              placeholder={t('forms.holding.annualRatePlaceholder')}
              suffix={t('forms.units.percent')}
              required
              error={annualRatePctError}
              inputRef={annualRatePctInputRef}
            />
          </View>

          <TermField
            value={term}
            onChangeValue={onChangeTerm}
            unit={termUnit}
            onSelectUnit={onSelectTermUnit}
            error={termError}
            fieldRef={termFieldRef}
            inputRef={termInputRef}
          />

          {/* The loan-payment matcher's own optional inputs — hidden here
            alongside rate/term (a 'none' schedule has no installments to
            match against at all, so these would do nothing there). Neither
            is required: the matcher is a convenience, not a blocking
            data-entry step. */}
          <PaymentHoldingField
            label={t('forms.holding.loanPaidFrom')}
            sheetTitle={t('forms.holding.loanPaidFromSheetTitle')}
            noneLabel={t('forms.holding.loanPaidFromNone')}
            options={paymentHoldingOptions}
            selectedId={paymentHoldingId}
            onSelect={onSelectPaymentHoldingId}
            testID="loan-payment-holding-field"
          />

          <TextField
            label={t('forms.holding.loanLenderName')}
            value={lenderName}
            onChangeText={onChangeLenderName}
            placeholder={t('forms.holding.loanLenderNamePlaceholder')}
          />

          <TextField
            label={t('forms.holding.loanLenderIban')}
            value={lenderIban}
            onChangeText={onChangeLenderIban}
            autoCapitalize="characters"
            placeholder={t('forms.holding.loanLenderIbanPlaceholder')}
          />
        </>
      )}
    </Box>
  );
};

export default LoanSection;
