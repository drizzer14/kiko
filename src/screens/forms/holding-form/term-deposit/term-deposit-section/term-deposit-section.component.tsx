import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { currencySymbol } from '@kiko/currency/currency';
import Button from '@kiko/design-system/components/button';
import Switch from '@kiko/design-system/components/switch';
import Divider from '@kiko/design-system/components/divider';
import ChipRow from '@kiko/design-system/components/chip-row';
import TextField from '@kiko/design-system/components/text-field';
import FieldError from '@kiko/design-system/components/field-error';
import type { CompoundingFrequency } from '@kiko/holdings/holding-metadata';

import DateField from '../../../date-field';
import {
  isContributionRowValid,
  type TermDepositFieldErrors,
} from '../use-term-deposit-fields/term-deposit-reasons';
import TermField, { termMaxFor } from '../../../term-field';
import { fieldErrorMessage } from '../../field-error-message';
import { groupAmount } from '../../../amount-format/amount-format';

import type { TermDepositSectionProps } from './term-deposit-section.props';

const compoundingOptions: readonly CompoundingFrequency[] = [
  'bi-weekly',
  'monthly',
  'quarterly',
  'annually',
];

// Coupon frequency additionally offers 'semiannually', which compounding
// does not; the shared vocabulary (monthly/quarterly/annually) resolves to
// the same catalog key either way.
const compoundingLabels = (t: TFunction): Record<CompoundingFrequency, string> => ({
  'bi-weekly': t('forms.holding.biWeekly'),
  monthly: t('forms.holding.monthly'),
  quarterly: t('forms.holding.quarterly'),
  annually: t('forms.holding.annually'),
});

// The contributions group's two sub-reasons (missing vs incomplete) render as
// TWO separate `<FieldError>`s though both come from the SAME
// `contributionsError` check — this narrows to the specific sub-reason each
// one owns, so neither shows for the other's cause.
const contributionsSubReasonMessage = (
  t: TFunction,
  attemptedSave: boolean,
  reasonKey: TermDepositFieldErrors['contributionsError'],
  expectedKey: NonNullable<TermDepositFieldErrors['contributionsError']>,
): string | undefined => (attemptedSave && reasonKey === expectedKey ? t(expectedKey) : undefined);

// The `type === 'term_deposit'` details block (everything below the
// Contributions heading) as its own leaf component, purely presentational:
// every piece of state and the validation reason lives in
// `useTermDepositFields`; this component only renders what it is handed.
const TermDepositSection: FC<TermDepositSectionProps> = ({ fields, attemptedSave }) => {
  const { t } = useTranslation();
  const { currency, contributions, fieldErrors, refs } = fields;

  const contributionsRequiredMessage = contributionsSubReasonMessage(
    t,
    attemptedSave,
    fieldErrors.contributionsError,
    'forms.holding.contributionsRequiredError',
  );
  const contributionIncompleteMessage = contributionsSubReasonMessage(
    t,
    attemptedSave,
    fieldErrors.contributionsError,
    'forms.holding.contributionIncompleteError',
  );

  return (
    <Box gap={4}>
      {/* The mapped contributions and the inline Add button form ONE group
          under a tighter inner gap (spacing(2) = 8pt), so the small Add
          button hugs the list — ~8pt below the last contribution — rather
          than sitting the section's full spacing(4) = 16pt below it. */}
      <Box gap={2} testID="contributions-group">
        <Box gap={4}>
          {contributions.map((contribution, index) => (
            <View
              key={contribution.id}
              // Row 0 anchors `contributionsFieldRef` (the Save-invalid
              // scroll target); the LAST row additionally anchors
              // `lastContributionFieldRef` (the add-row scroll target) — a
              // callback ref, since a single native element can only take
              // one `ref` prop, and a one-row list satisfies both
              // conditions on the SAME node.
              ref={(node) => {
                if (index === 0) {
                  refs.contributionsFieldRef.current = node;
                }
                if (index === contributions.length - 1) {
                  refs.lastContributionFieldRef.current = node;
                }
              }}
            >
              <Box gap={2}>
                <TextField
                  label={t('forms.holding.contributionAmount', { index: index + 1 })}
                  value={contribution.amount}
                  onChangeText={(next) => fields.updateContributionAmount(index, groupAmount(next))}
                  keyboardType="decimal-pad"
                  placeholder={t('forms.holding.contributionPlaceholder')}
                  suffix={currencySymbol[currency]}
                  required
                />

                <DateField
                  label={t('forms.holding.contributionDate', { index: index + 1 })}
                  value={contribution.date}
                  onChange={(next) => fields.updateContributionDate(index, next)}
                  placeholder={t('forms.fields.selectDatePlaceholder')}
                  required
                />

                {index === 0 && contributionsRequiredMessage !== undefined && (
                  <FieldError message={contributionsRequiredMessage} />
                )}

                {/* A row left blank or half-filled once at least one OTHER
                    row is already valid — `contributionsRequiredMessage`
                    above only fires when EVERY row is empty, so this
                    catches the row `parsedContributions` would otherwise
                    silently drop. */}
                {contributionIncompleteMessage !== undefined &&
                  !isContributionRowValid(contribution) && (
                    <FieldError message={contributionIncompleteMessage} />
                  )}

                {contributions.length > 1 && (
                  <Button
                    variant="destructiveTonal"
                    size="small"
                    fullWidth={false}
                    icon="trash"
                    disabled={contribution.saved}
                    accessibilityLabel={t('forms.holding.removeContribution', {
                      index: index + 1,
                    })}
                    onPress={() => fields.removeContribution(index)}
                  >
                    {t('forms.holding.remove')}
                  </Button>
                )}
              </Box>
            </View>
          ))}
        </Box>

        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          icon="plus"
          onPress={fields.addContribution}
        >
          {t('forms.holding.addContribution')}
        </Button>
      </Box>

      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.terms')}</Text>

      <View ref={refs.annualRateFieldRef}>
        <TextField
          label={t('forms.holding.annualRatePct')}
          value={fields.annualRate}
          onChangeText={fields.setAnnualRate}
          keyboardType="decimal-pad"
          placeholder={t('forms.holding.annualRatePlaceholder')}
          suffix={t('forms.units.percent')}
          required
          error={fieldErrorMessage(t, attemptedSave, fieldErrors.annualRateError)}
          inputRef={refs.annualRateInputRef}
        />
      </View>

      <TermField
        value={fields.term}
        onChangeValue={fields.setTerm}
        unit={fields.termUnit}
        onSelectUnit={fields.setTermUnit}
        error={fieldErrorMessage(t, attemptedSave, fieldErrors.termError, {
          max: termMaxFor(fields.termUnit),
        })}
        fieldRef={refs.termFieldRef}
        inputRef={refs.termInputRef}
      />

      <Switch
        label={t('forms.holding.recapitalization')}
        value={fields.recapitalization}
        onValueChange={fields.setRecap}
      />

      <ChipRow
        label={t('forms.holding.compounding')}
        options={compoundingOptions}
        selected={fields.compounding}
        onSelect={fields.setCompounding}
        labels={compoundingLabels(t)}
      />
    </Box>
  );
};

export default TermDepositSection;
