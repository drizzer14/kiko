import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { currencySymbol } from '@kiko/currency/currency';
import Divider from '@kiko/design-system/components/divider';
import { termMaxFor } from '@kiko/screens/forms/term-reasons';
import { groupAmount } from '@kiko/screens/forms/amount-format';

import LoanSection from '../loan-section';
import { fieldErrorMessage } from '../../field-error-message';

import type { LoanFormBlockProps } from './loan-form-block.props';

// The `type === 'loan'` details block as its own leaf component, keeping
// its own cognitive-complexity budget separate from the screen's.
const LoanFormBlock: FC<LoanFormBlockProps> = ({
  fields,
  attemptedSave,
  paymentHoldingOptions,
}) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <LoanSection
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
        term={fields.term}
        onChangeTerm={fields.setTerm}
        termUnit={fields.termUnit}
        onSelectTermUnit={fields.setTermUnit}
        termError={fieldErrorMessage(t, attemptedSave, fieldErrors.termError, {
          max: termMaxFor(fields.termUnit),
        })}
        termFieldRef={refs.termFieldRef}
        termInputRef={refs.termInputRef}
        paymentHoldingId={fields.paymentHoldingId}
        onSelectPaymentHoldingId={fields.setPaymentHoldingId}
        paymentHoldingOptions={paymentHoldingOptions}
        lenderName={fields.lenderName}
        onChangeLenderName={fields.setLenderName}
        lenderIban={fields.lenderIban}
        onChangeLenderIban={fields.setLenderIban}
      />
    </Box>
  );
};

export default LoanFormBlock;
