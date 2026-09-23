import type { FC } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import OptionPills from '../../../design-system/components/option-pills';
import ColumnSelectField from '../column-select-field';

import type { AmountFieldsProps, AmountMode } from './amount-fields.props';

const amountModeLabel = (t: TFunction, mode: AmountMode): string =>
  t(mode === 'single' ? 'columnMapping.amountModeSingle' : 'columnMapping.amountModeDebitCredit');

/**
 * The column-mapping screen's own amount fields: the single-vs-debit/credit
 * mode pill, then either one amount-column field or a debit/credit pair —
 * extracted out of the screen so its own JSX branching doesn't count against
 * that component's cognitive-complexity budget.
 */
const AmountFields: FC<AmountFieldsProps> = ({
  columnOptions,
  mode,
  onModeChange,
  amountColumn,
  onAmountColumnChange,
  debitColumn,
  onDebitColumnChange,
  creditColumn,
  onCreditColumnChange,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <OptionPills<AmountMode>
        options={['single', 'debitCredit']}
        selected={mode}
        onSelect={onModeChange}
        label={(option) => amountModeLabel(t, option)}
      />

      {mode === 'single' && (
        <ColumnSelectField
          label={t('columnMapping.amountColumn')}
          options={columnOptions}
          selected={amountColumn}
          onSelect={onAmountColumnChange}
          testID="column-mapping-amount-column"
        />
      )}

      {mode === 'debitCredit' && (
        <>
          <ColumnSelectField
            label={t('columnMapping.debitColumn')}
            options={columnOptions}
            selected={debitColumn}
            onSelect={onDebitColumnChange}
            testID="column-mapping-debit-column"
          />

          <ColumnSelectField
            label={t('columnMapping.creditColumn')}
            options={columnOptions}
            selected={creditColumn}
            onSelect={onCreditColumnChange}
            testID="column-mapping-credit-column"
          />
        </>
      )}
    </>
  );
};

export default AmountFields;
