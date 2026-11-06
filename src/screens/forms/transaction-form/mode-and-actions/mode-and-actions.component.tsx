import { View } from 'react-native';
import type { ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import CategoryField from '@kiko/screens/forms/category-field';
import LoanPaymentField from '@kiko/screens/forms/loan-payment-field';

import type { ModeAndActionsProps } from './mode-and-actions.props';

// The category and loan pickers: everything below the main field group
// EXCEPT while converting (a convert has no category — just the convert
// group and Save). Deleting a transaction is offered only through the row's
// touch-and-hold context menu (`CardContextMenu`), not from this form. The
// transaction-TYPE selector is NOT here; `FieldGroup` lays it beside the
// amount, and "Convert to exchange" is the screen's footer. A component of its own for the same
// cognitive-complexity-budget reason as `FieldGroup`: several independent
// `&&`-gated conditions, kept out of the screen component's own branch count.
const ModeAndActions = (props: ModeAndActionsProps): ReactElement | null => {
  if (props.converting) {
    return null;
  }

  return (
    <>
      {/* The category picker is ALWAYS editable on an income/expense row —
        even on a synced row — since a category edit propagates to every
        same-name transaction and to future imports, unlike the bank-owned
        amount/sign. Exchange has no category: both legs' descriptions are
        fixed, auto-generated copy. */}
      {!props.isExchange && (
        <Box gap={1}>
          <View ref={props.categoryFieldRef}>
            <CategoryField
              label={props.t('forms.transaction.category')}
              sheetTitle={props.t('forms.transaction.categorySheetTitle')}
              testID="transaction-category-field"
              options={props.categoryOptions}
              selectedKey={props.selectedCategory}
              onSelect={props.onSelectCategory}
              // A category is required only on a fresh add (`plainFieldErrors`
              // gates a create on it); an edit and a template leave it optional.
              required={props.categoryRequired}
              error={props.categoryError}
            />
          </View>

          {/* Says why a bank debit that paid for an exchange purchase is left out of
            spending: informational, so a bare caption like the loan field's auto-link caption. */}
          {props.exchangeFundingCaptionKey !== undefined && (
            <Text variant="caption" tone="textSecondary">
              {props.t(props.exchangeFundingCaptionKey)}
            </Text>
          )}
        </Box>
      )}

      {/* Shown for BOTH a manual and a synced row — an existing debit's own
        loan link is user state, not a mutation of bank-owned ledger data
        (`transactionsRepo.setLoanPayment`/`undoAutoLoanLink` carry no source
        gate, same as the category field above), so a read-only synced row
        stays writable here too. Data-driven visibility, not a flag: hidden
        outright whenever `loanOptions` is empty — see `isLoanFieldVisible`'s
        own doc comment. */}
      {props.loanFieldVisible && (
        <LoanPaymentField
          label={props.t('forms.transaction.loanPayment')}
          sheetTitle={props.t('forms.transaction.loanPaymentSheetTitle')}
          noneLabel={props.t('forms.transaction.loanPaymentNone')}
          testID="transaction-loan-payment-field"
          options={props.loanOptions}
          selectedId={props.selectedLoanHoldingId}
          onSelect={props.onSelectLoanPayment}
          linkSource={props.loanLinkSource}
          autoLinkedCaption={props.t('forms.transaction.loanLinkedAuto')}
          undoLabel={props.t('forms.transaction.loanLinkUndo')}
          onUndo={props.onUndoLoanLink}
        />
      )}
    </>
  );
};

export default ModeAndActions;
