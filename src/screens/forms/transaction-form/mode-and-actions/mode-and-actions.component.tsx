import { View } from 'react-native';
import type { ReactElement } from 'react';
import Button from '@kiko/design-system/components/button';
import CategoryField from '@kiko/screens/forms/category-field';
import LoanPaymentField from '@kiko/screens/forms/loan-payment-field';

import type { ModeAndActionsProps } from './mode-and-actions.props';

// The category picker and "Convert to exchange" action: everything below the
// main field group EXCEPT while converting (a convert has no category — just
// the convert group and Save). Deleting a transaction is offered only through
// the row's touch-and-hold context menu (`CardContextMenu`), not from this
// form. The transaction-TYPE selector is NOT here; it renders above the field
// group, under the Holding select. A component of its own for the same
// cognitive-complexity-budget reason as `FieldGroup`: several independent
// `&&`-gated conditions, kept out of the screen component's own branch count.
const ModeAndActions = (props: ModeAndActionsProps): ReactElement | null => {
  if (props.converting) {
    return null;
  }

  return (
    <>
      {/* The transaction-TYPE selector does not live here: it renders as a
        select field directly under the Holding select, above the field group.
        This component owns only the category picker and the "Convert to
        exchange" action — everything below the field group except while
        converting. */}

      {/* The category picker is ALWAYS editable on an income/expense row —
        even on a synced row — since a category edit propagates to every
        same-name transaction and to future imports, unlike the bank-owned
        amount/sign. Exchange has no category: both legs' descriptions are
        fixed, auto-generated copy. */}
      {!props.isExchange && (
        <View ref={props.categoryFieldRef}>
          <CategoryField
            label={props.t('forms.transaction.category')}
            sheetTitle={props.t('forms.transaction.categorySheetTitle')}
            testID="transaction-category-field"
            options={props.categoryOptions}
            selectedKey={props.selectedCategory}
            onSelect={props.onSelectCategory}
            // A category is required only on a fresh add (`plainFieldErrors`
            // gates a create on it); an edit leaves the category optional.
            required={!props.isEditing}
            error={props.categoryError}
          />
        </View>
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

      {/* Shown for BOTH a manual and a synced row — the existing row gets only
        the pair id (plus the marker when it is manual or imported), so a
        read-only synced row stays safe to convert.
        Not gated by `!isReadOnly` for that reason. */}
      {props.convertEligible && (
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          icon="arrow.left.arrow.right"
          onPress={props.onPressConvert}
        >
          {props.t('forms.transaction.convertToExchange')}
        </Button>
      )}
    </>
  );
};

export default ModeAndActions;
