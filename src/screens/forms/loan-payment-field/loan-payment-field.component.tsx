import type { ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';

import PaymentHoldingField from '../payment-holding-field';

import type { LoanPaymentFieldProps } from './loan-payment-field.props';

// A single-select loan-holding picker for an existing debit transaction's
// "loan payment" link — the field-plus-sheet chrome itself lives in
// `PaymentHoldingField` (shared with the loan form's own "Paid from" field);
// this component adds only the auto-link caption + Undo below it. Purely
// presentational: the caller (the transaction form) builds and filters
// `options` and persists every pick AT ONCE through
// `transactionsRepo.setLoanPayment` — there is no local pending state and no
// Save-button gating here, unlike the category picker, which only stages a
// change until Save.
const LoanPaymentField = ({
  label,
  sheetTitle,
  noneLabel,
  options,
  selectedId,
  onSelect,
  linkSource,
  autoLinkedCaption,
  undoLabel,
  onUndo,
  testID,
}: LoanPaymentFieldProps): ReactElement => (
  <Box gap={1}>
    <PaymentHoldingField
      label={label}
      sheetTitle={sheetTitle}
      noneLabel={noneLabel}
      options={options}
      selectedId={selectedId}
      onSelect={onSelect}
      testID={testID}
    />

    {/* An auto-suggested link (the matcher's own `setAutoLoanLinks` path)
      surfaces its own caption + an Undo action here. A manual link (the
      user's own pick, above) needs neither — it was already an explicit
      choice, so undoing it is just picking a different option. */}
    {linkSource === 'auto' && (
      <Box gap={1}>
        <Text variant="caption" tone="textSecondary">
          {autoLinkedCaption}
        </Text>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={onUndo}
          testID={testID ? `${testID}-undo` : undefined}
        >
          {undoLabel}
        </Button>
      </Box>
    )}
  </Box>
);

export default LoanPaymentField;
