import type { FC } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import CurrencyField from '@kiko/design-system/components/currency-field';
import SegmentedControl from '@kiko/design-system/components/segmented-control';

import ColumnSelectField from '../column-select-field';

import type { CurrencyFieldsProps, CurrencyMode } from './currency-fields.props';

const currencyModeLabels = (t: TFunction): Record<CurrencyMode, string> => ({
  column: t('columnMapping.currencyColumn'),
  fixed: t('columnMapping.fixedCurrency'),
});

/**
 * The column-mapping screen's own currency fields: the column-vs-fixed mode
 * pill, then either a currency-column field or the shared `CurrencyField`
 * defaulted from the caller (the account's first holding currency, else
 * UAH — the caller resolves that default, this component just renders
 * whatever `fixedCurrency` it is handed). Extracted out of the screen for
 * the same reason `AmountFields` is.
 */
const CurrencyFields: FC<CurrencyFieldsProps> = ({
  columnOptions,
  mode,
  onModeChange,
  currencyColumn,
  onCurrencyColumnChange,
  fixedCurrency,
  onFixedCurrencyChange,
  currencyColumnError,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <SegmentedControl<CurrencyMode>
        options={['column', 'fixed']}
        selected={mode}
        onSelect={onModeChange}
        labels={currencyModeLabels(t)}
        accessibilityLabel={t('columnMapping.sectionCurrency')}
      />

      {mode === 'column' && (
        <ColumnSelectField
          label={t('columnMapping.currencyColumn')}
          sheetTitle={t('columnMapping.currencyColumnSheetTitle')}
          options={columnOptions}
          selected={currencyColumn}
          onSelect={onCurrencyColumnChange}
          required
          placeholder={t('columnMapping.currencyColumnPlaceholder')}
          error={currencyColumnError}
          testID="column-mapping-currency-column"
        />
      )}

      {mode === 'fixed' && (
        <CurrencyField
          label={t('columnMapping.fixedCurrency')}
          sheetTitle={t('columnMapping.fixedCurrencySheetTitle')}
          selected={fixedCurrency}
          onSelect={onFixedCurrencyChange}
          testID="column-mapping-fixed-currency"
        />
      )}
    </>
  );
};

export default CurrencyFields;
