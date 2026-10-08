import type { FC } from 'react';
import { match } from 'ts-pattern';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import DateField from '@kiko/screens/forms/date-field';
import TextField from '@kiko/design-system/components/text-field';
import FieldLabel from '@kiko/design-system/components/field-label';
import SegmentedControl from '@kiko/design-system/components/segmented-control';
import { ownershipInputs, type OwnershipInput } from '@kiko/holdings/holding-metadata';

import type { OwnershipFieldProps } from './ownership-field.props';

const modeLabels = (t: TFunction): Record<OwnershipInput, string> => ({
  percent: t('forms.holding.ownershipPercent'),
  fraction: t('forms.holding.ownershipFraction'),
});

// The share of the whole asset the user owns. Percent | Fraction is a
// SegmentedControl, not chips: the mode changes which fields show (one
// percent field, or a share and an out-of field). The effective date only
// matters once an edit changes the share, so it shows only then.
const OwnershipField: FC<OwnershipFieldProps> = ({
  mode,
  onSelectMode,
  percent,
  onChangePercent,
  numerator,
  onChangeNumerator,
  denominator,
  onChangeDenominator,
  showsEffectiveDate,
  effectiveDate,
  onChangeEffectiveDate,
  error,
  fieldRef,
  inputRef,
}) => {
  const { t } = useTranslation();

  const shareFields = match(mode)
    .with('percent', () => (
      <TextField
        label={t('forms.holding.ownershipNumerator')}
        value={percent}
        onChangeText={onChangePercent}
        keyboardType="decimal-pad"
        suffix={t('forms.units.percent')}
        required
        error={error}
        inputRef={inputRef}
        testID="ownership-percent-field"
      />
    ))
    .with('fraction', () => (
      <Box gap={4}>
        <TextField
          label={t('forms.holding.ownershipNumerator')}
          value={numerator}
          onChangeText={onChangeNumerator}
          keyboardType="number-pad"
          required
          inputRef={inputRef}
          testID="ownership-numerator-field"
        />

        <TextField
          label={t('forms.holding.ownershipDenominator')}
          value={denominator}
          onChangeText={onChangeDenominator}
          keyboardType="number-pad"
          required
          error={error}
          testID="ownership-denominator-field"
        />
      </Box>
    ))
    .exhaustive();

  return (
    <Box gap={4}>
      <Box gap={1}>
        <FieldLabel label={t('forms.holding.ownership')} />

        <SegmentedControl<OwnershipInput>
          options={ownershipInputs}
          selected={mode}
          onSelect={onSelectMode}
          labels={modeLabels(t)}
          accessibilityLabel={t('forms.holding.ownership')}
          testID="ownership-mode"
        />
      </Box>

      <View ref={fieldRef}>{shareFields}</View>

      {showsEffectiveDate && (
        <DateField
          label={t('forms.holding.ownershipEffectiveDate')}
          sheetTitle={t('forms.holding.ownershipEffectiveDateSheetTitle')}
          value={effectiveDate}
          onChange={onChangeEffectiveDate}
          placeholder={t('forms.fields.selectDatePlaceholder')}
          required
          testID="ownership-effective-date"
        />
      )}
    </Box>
  );
};

export default OwnershipField;
