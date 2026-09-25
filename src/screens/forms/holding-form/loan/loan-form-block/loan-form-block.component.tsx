import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import LoanSection from '../loan-section';
import Box from '../../../../../design-system/components/box';
import { fieldErrorMessage } from '../../field-error-message';
import Text from '../../../../../design-system/components/text';
import { currencySymbol } from '../../../../../currency/currency';
import { groupAmount } from '../../../amount-format/amount-format';
import Divider from '../../../../../design-system/components/divider';

import type { LoanFormBlockProps } from './loan-form-block.props';

// The `type === 'loan'` details block as its own leaf component, keeping its
// own cognitive-complexity budget instead of adding another branch to the
// already-at-the-ceiling screen. The screen itself gates this on
// `type === 'loan'`, so this component always renders once mounted.
const LoanFormBlock: FC<LoanFormBlockProps> = ({ fields, attemptedSave }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <LoanSection
        kind={fields.kind}
        onSelectKind={fields.setKind}
        principal={fields.principal}
        onChangePrincipal={(text) => fields.setPrincipal(groupAmount(text))}
        principalError={fieldErrorMessage(t, attemptedSave, fieldErrors.principalError)}
        principalFieldRef={refs.principalFieldRef}
        principalInputRef={refs.principalInputRef}
        currencySuffix={currencySymbol[fields.currency]}
        startDate={fields.startDate}
        onChangeStartDate={fields.setStartDate}
        startDateError={fieldErrorMessage(t, attemptedSave, fieldErrors.startDateError)}
        startDateFieldRef={refs.startDateFieldRef}
        schedule={fields.schedule}
        onSelectSchedule={fields.setSchedule}
        annualRatePct={fields.annualRatePct}
        onChangeAnnualRatePct={fields.setAnnualRatePct}
        annualRatePctError={fieldErrorMessage(t, attemptedSave, fieldErrors.annualRateError)}
        annualRatePctFieldRef={refs.annualRateFieldRef}
        annualRatePctInputRef={refs.annualRateInputRef}
        termMonths={fields.termMonths}
        onChangeTermMonths={fields.setTermMonths}
        termMonthsError={fieldErrorMessage(t, attemptedSave, fieldErrors.termMonthsError)}
        termMonthsFieldRef={refs.termMonthsFieldRef}
        termMonthsInputRef={refs.termMonthsInputRef}
      />
    </Box>
  );
};

export default LoanFormBlock;
