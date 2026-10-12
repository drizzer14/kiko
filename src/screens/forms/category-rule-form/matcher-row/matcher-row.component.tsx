import type { FC } from 'react';
import { match } from 'ts-pattern';
import {
  type AmountOperator,
  type CategoryRuleMatcher,
  type RuleDirection,
  type TimeOperator,
  minuteOfDayOf,
} from '@kiko/categories/category-rules';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import TimeField from '@kiko/screens/forms/time-field';
import { currencySymbol } from '@kiko/currency/currency';
import Button from '@kiko/design-system/components/button';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import TextField from '@kiko/design-system/components/text-field';
import SelectField from '@kiko/design-system/components/select-field';
import CurrencyField from '@kiko/design-system/components/currency-field';
import SegmentedControl from '@kiko/design-system/components/segmented-control';

import type { MatcherRowProps } from './matcher-row.props';

type MatcherType = CategoryRuleMatcher['type'];

const MATCHER_TYPES = [
  'nameIs',
  'nameStartsWith',
  'amount',
  'direction',
  'time',
] as const satisfies readonly MatcherType[];

const AMOUNT_OPERATORS = [
  'eq',
  'gt',
  'gte',
  'lt',
  'lte',
] as const satisfies readonly AmountOperator[];

const DIRECTIONS = ['expense', 'income'] as const satisfies readonly RuleDirection[];

const TIME_OPERATORS = ['before', 'after'] as const satisfies readonly TimeOperator[];

// A day with no clock change, so every minute of the day exists as a wall-clock time for the field.
const wallClockOf = (minuteOfDay: number): number => new Date(2000, 0, 1, 0, minuteOfDay).getTime();

// One condition of a rule: a select for its type and the inputs that type needs. The row keeps no
// state of its own; the editor holds every draft, so a row can change type and back without
// losing what was typed.
const MatcherRow: FC<MatcherRowProps> = ({
  draft,
  position,
  canRemove,
  onChange,
  onRemove,
  error,
}) => {
  const { t } = useTranslation();

  const typeLabels: Record<MatcherType, string> = {
    nameIs: t('ruleForm.nameIs'),
    nameStartsWith: t('ruleForm.nameStartsWith'),
    amount: t('ruleForm.amount'),
    direction: t('ruleForm.direction'),
    time: t('ruleForm.time'),
  };

  const inputs = match(draft.type)
    .with('nameIs', 'nameStartsWith', () => (
      <TextField
        label={t('forms.fields.name')}
        value={draft.text}
        onChangeText={(text) => onChange({ text })}
        required
        error={error}
      />
    ))
    .with('amount', () => (
      <>
        <SelectField<AmountOperator>
          label={t('ruleForm.operator')}
          sheetTitle={t('ruleForm.operatorSheetTitle')}
          options={AMOUNT_OPERATORS}
          selected={draft.amountOperator}
          onSelect={(amountOperator) => onChange({ amountOperator })}
          labels={{
            eq: t('ruleForm.equal'),
            gt: t('ruleForm.more'),
            gte: t('ruleForm.atLeast'),
            lt: t('ruleForm.less'),
            lte: t('ruleForm.atMost'),
          }}
          placeholder={t('ruleForm.selectOperator')}
          testID={`matcher-operator-${position}`}
        />

        <TextField
          label={t('forms.fields.amount')}
          value={draft.amountText}
          onChangeText={(text) => onChange({ amountText: groupAmount(text) })}
          keyboardType="decimal-pad"
          suffix={currencySymbol[draft.currency]}
          required
          error={error}
        />

        <CurrencyField
          label={t('forms.fields.currency')}
          sheetTitle={t('forms.fields.currencySheetTitle')}
          selected={draft.currency}
          onSelect={(currency) => onChange({ currency })}
          testID={`matcher-currency-${position}`}
        />
      </>
    ))
    .with('direction', () => (
      <SegmentedControl<RuleDirection>
        options={DIRECTIONS}
        selected={draft.direction}
        onSelect={(direction) => onChange({ direction })}
        labels={{ expense: t('forms.transaction.expense'), income: t('forms.transaction.income') }}
        accessibilityLabel={t('ruleForm.direction')}
      />
    ))
    .with('time', () => (
      <>
        <SegmentedControl<TimeOperator>
          options={TIME_OPERATORS}
          selected={draft.timeOperator}
          onSelect={(timeOperator) => onChange({ timeOperator })}
          labels={{ before: t('ruleForm.before'), after: t('ruleForm.after') }}
          accessibilityLabel={t('ruleForm.time')}
        />

        <TimeField
          label={t('forms.fields.time')}
          sheetTitle={t('forms.fields.timeSheetTitle')}
          value={wallClockOf(draft.minuteOfDay)}
          onChange={(timestamp) => onChange({ minuteOfDay: minuteOfDayOf(timestamp) })}
          placeholder={t('forms.fields.selectTimePlaceholder')}
        />

        <Text variant="caption" tone="textSecondary">
          {t('ruleForm.timeHint')}
        </Text>
      </>
    ))
    .exhaustive();

  return (
    <Box gap={2}>
      <SelectField<MatcherType>
        label={t('ruleForm.condition')}
        sheetTitle={t('ruleForm.conditionSheetTitle')}
        options={MATCHER_TYPES}
        selected={draft.type}
        onSelect={(type) => onChange({ type })}
        labels={typeLabels}
        placeholder={t('ruleForm.selectCondition')}
        testID={`matcher-type-${position}`}
      />

      {inputs}

      {canRemove && (
        <Button
          variant="destructiveTonal"
          size="small"
          fullWidth={false}
          icon="trash"
          accessibilityLabel={t('ruleForm.removeCondition', { index: position + 1 })}
          onPress={onRemove}
        >
          {t('ruleForm.remove')}
        </Button>
      )}
    </Box>
  );
};

export default MatcherRow;
