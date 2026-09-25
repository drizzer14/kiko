import type { FC } from 'react';

import LoanSection from '../loan-section';
import { fieldErrorMessage } from '../field-error-message';
import Box from '../../../../design-system/components/box';
import Text from '../../../../design-system/components/text';
import { currencySymbol } from '../../../../currency/currency';
import { groupAmount } from '../../amount-format/amount-format';
import Divider from '../../../../design-system/components/divider';

import type { LoanFormBlockProps } from './loan-form-block.props';

// The `type === 'loan'` details block as its own leaf component, keeping its
// own cognitive-complexity budget instead of adding another branch to the
// already-at-the-ceiling screen. Renders null outside `type === 'loan'`, the
// same as the `&&` it replaces.
const LoanFormBlock: FC<LoanFormBlockProps> = ({
  type,
  t,
  attemptedSave,
  currency,
  loanFields,
  loanPrincipalFieldRef,
  loanPrincipalInputRef,
  loanStartDateFieldRef,
  annualRateFieldRef,
  annualRateInputRef,
  termMonthsFieldRef,
  termMonthsInputRef,
}) => {
  if (type !== 'loan') {
    return null;
  }

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <LoanSection
        kind={loanFields.kind}
        onSelectKind={loanFields.setKind}
        principal={loanFields.principal}
        onChangePrincipal={(text) => loanFields.setPrincipal(groupAmount(text))}
        principalError={fieldErrorMessage(t, attemptedSave, loanFields.fieldErrors.principalError)}
        principalFieldRef={loanPrincipalFieldRef}
        principalInputRef={loanPrincipalInputRef}
        currencySuffix={currencySymbol[currency]}
        startDate={loanFields.startDate}
        onChangeStartDate={loanFields.setStartDate}
        startDateError={fieldErrorMessage(t, attemptedSave, loanFields.fieldErrors.startDateError)}
        startDateFieldRef={loanStartDateFieldRef}
        schedule={loanFields.schedule}
        onSelectSchedule={loanFields.setSchedule}
        annualRatePct={loanFields.annualRatePct}
        onChangeAnnualRatePct={loanFields.setAnnualRatePct}
        annualRatePctError={fieldErrorMessage(
          t,
          attemptedSave,
          loanFields.fieldErrors.annualRateError,
        )}
        annualRatePctFieldRef={annualRateFieldRef}
        annualRatePctInputRef={annualRateInputRef}
        termMonths={loanFields.termMonths}
        onChangeTermMonths={loanFields.setTermMonths}
        termMonthsError={fieldErrorMessage(
          t,
          attemptedSave,
          loanFields.fieldErrors.termMonthsError,
        )}
        termMonthsFieldRef={termMonthsFieldRef}
        termMonthsInputRef={termMonthsInputRef}
      />
    </Box>
  );
};

export default LoanFormBlock;
