import type { FC } from 'react';
import { match } from 'ts-pattern';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import ChipRow from '@kiko/design-system/components/chip-row';
import TextField from '@kiko/design-system/components/text-field';

import type { TermFieldProps } from './term-field.props';
import { termUnits, type TermUnit } from './term-reasons';

// The deposit and loan term: a whole number typed in months or years, the
// unit shown after it. The Months/Years choice is a ChipRow, not a
// SegmentedControl — it changes what the number means, never which fields
// show (the same call as the metal Unit chips). Storage stays `termMonths`;
// see `termMonthsFromInput`.
const TermField: FC<TermFieldProps> = ({
  value,
  onChangeValue,
  unit,
  onSelectUnit,
  error,
  fieldRef,
  inputRef,
}) => {
  const { t } = useTranslation();

  const unitLabels: Record<TermUnit, string> = {
    months: t('forms.holding.termUnitMonths'),
    years: t('forms.holding.termUnitYears'),
  };

  const suffix = match(unit)
    .with('months', () => t('forms.units.months'))
    .with('years', () => t('forms.units.years'))
    .exhaustive();

  return (
    <Box gap={2}>
      <View ref={fieldRef}>
        <TextField
          label={t('forms.holding.termMonths')}
          value={value}
          onChangeText={onChangeValue}
          keyboardType="number-pad"
          placeholder={t('forms.holding.termMonthsPlaceholder')}
          suffix={suffix}
          required
          error={error}
          inputRef={inputRef}
        />
      </View>

      <ChipRow options={termUnits} selected={unit} onSelect={onSelectUnit} labels={unitLabels} />
    </Box>
  );
};

export default TermField;
