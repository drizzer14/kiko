import type { FC } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import OptionPills from '../../../design-system/components/option-pills';
import CurrencyField from '../../../design-system/components/currency-field';
import ColumnSelectField from '../column-select-field';

import type { CurrencyFieldsProps, CurrencyMode } from './currency-fields.props';

const currencyModeLabel = (t: TFunction, mode: CurrencyMode): string =>
  t(mode === 'column' ? 'columnMapping.currencyColumn' : 'columnMapping.fixedCurrency');

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
}) => {
  const { t } = useTranslation();

  return (
    <>
      <OptionPills<CurrencyMode>
        options={['column', 'fixed']}
        selected={mode}
        onSelect={onModeChange}
        label={(option) => currencyModeLabel(t, option)}
      />

      {mode === 'column' && (
        <ColumnSelectField
          label={t('columnMapping.currencyColumn')}
          options={columnOptions}
          selected={currencyColumn}
          onSelect={onCurrencyColumnChange}
          required
          testID="column-mapping-currency-column"
        />
      )}

      {mode === 'fixed' && (
        <CurrencyField
          label={t('columnMapping.fixedCurrency')}
          selected={fixedCurrency}
          onSelect={onFixedCurrencyChange}
          testID="column-mapping-fixed-currency"
        />
      )}
    </>
  );
};

export default CurrencyFields;
