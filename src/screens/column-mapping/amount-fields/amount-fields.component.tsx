import type { FC } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import ColumnSelectField from '../column-select-field';
import SegmentedControl from '../../../design-system/components/segmented-control';

import type { AmountFieldsProps, AmountMode } from './amount-fields.props';

const amountModeLabels = (t: TFunction): Record<AmountMode, string> => ({
  single: t('columnMapping.amountModeSingle'),
  debitCredit: t('columnMapping.amountModeDebitCredit'),
});

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
      <SegmentedControl<AmountMode>
        options={['single', 'debitCredit']}
        selected={mode}
        onSelect={onModeChange}
        labels={amountModeLabels(t)}
        testID="column-mapping-amount-mode-control"
      />

      {mode === 'single' && (
        <ColumnSelectField
          label={t('columnMapping.amountColumn')}
          options={columnOptions}
          selected={amountColumn}
          onSelect={onAmountColumnChange}
          required
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
            required
            testID="column-mapping-debit-column"
          />

          <ColumnSelectField
            label={t('columnMapping.creditColumn')}
            options={columnOptions}
            selected={creditColumn}
            onSelect={onCreditColumnChange}
            required
            testID="column-mapping-credit-column"
          />
        </>
      )}
    </>
  );
};

export default AmountFields;
