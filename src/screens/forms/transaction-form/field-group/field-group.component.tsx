import { View } from 'react-native';
import type { ReactElement } from 'react';
import DateTimeRow from '@kiko/screens/forms/date-time-row';
import ExchangeFields from '@kiko/screens/forms/exchange-fields';
import TextField from '@kiko/design-system/components/text-field';
import ConvertExchangeFields from '@kiko/screens/forms/convert-exchange-fields';

import type { FieldGroupProps } from './field-group.props';

// The screen's main field group: convert-mode's single-counterpart group,
// Exchange's two-leg group, or income/expense's plain Amount/Description/Date
// group — exactly one of the three renders at a time. A component of its own
// (if/return rather than a nested ternary inline in the screen's JSX) so
// `noNestedTernary` stays satisfied and the screen component's own
// cognitive-complexity budget is spent on state and save/derive logic, not
// this three-way render switch.
const FieldGroup = (props: FieldGroupProps): ReactElement => {
  if (props.converting) {
    return (
      <ConvertExchangeFields
        fixedLabel={props.convertView.fixedLabel}
        fixedValue={props.convertView.fixedValue}
        fixedSuffix={props.fixedSuffix}
        counterpartLabel={props.convertView.counterpartLabel}
        counterpartSheetTitle={props.convertView.counterpartSheetTitle}
        counterpartPlaceholder={props.t('forms.transaction.selectHolding')}
        counterpartOptions={props.convertView.options}
        counterpartHoldingId={props.counterpartHoldingId}
        onSelectCounterpart={props.onSelectCounterpart}
        onCreateCounterpart={props.onCreateCounterpart}
        counterpartAmountLabel={props.convertView.counterpartAmountLabel}
        counterpartAmount={props.counterpartAmount}
        onChangeCounterpartAmount={props.onChangeCounterpartAmount}
        counterpartSuffix={props.counterpartSuffix}
        time={props.time}
        onChangeTime={props.onChangeTime}
        maxDate={props.maxDate}
        counterpartError={props.counterpartError}
        counterpartAmountError={props.counterpartAmountError}
        counterpartFieldRef={props.counterpartFieldRef}
        counterpartAmountFieldRef={props.counterpartAmountFieldRef}
      />
    );
  }

  if (props.isExchange) {
    return (
      <ExchangeFields
        valueOut={props.amount}
        onChangeValueOut={props.onChangeAmount}
        valueOutSuffix={props.amountSuffix}
        destinationOptions={props.destinationOptions}
        destinationHoldingId={props.destinationHoldingId}
        onSelectDestination={props.onSelectDestination}
        onCreateDestination={props.onCreateDestination}
        valueIn={props.valueIn}
        onChangeValueIn={props.onChangeValueIn}
        valueInSuffix={props.valueInSuffix}
        time={props.time}
        onChangeTime={props.onChangeTime}
        maxDate={props.maxDate}
        valueOutError={props.valueOutError}
        destinationError={props.destinationError}
        valueInError={props.valueInError}
        valueOutFieldRef={props.valueOutFieldRef}
        destinationFieldRef={props.destinationFieldRef}
        valueInFieldRef={props.valueInFieldRef}
      />
    );
  }

  return (
    <>
      <View ref={props.amountFieldRef}>
        <TextField
          label={props.t('forms.fields.amount')}
          value={props.amount}
          onChangeText={props.onChangeAmount}
          editable={!props.isReadOnly}
          keyboardType="decimal-pad"
          placeholder={props.t('forms.transaction.amountPlaceholder')}
          suffix={props.amountSuffix}
          // A read-only (synced) row's amount never gates save, so it carries
          // no required marker; a manual add/edit always needs a positive
          // amount.
          required={!props.isReadOnly}
          error={props.amountError}
          invalid={props.amountInvalid}
          inputRef={props.amountInputRef}
        />
      </View>

      <TextField
        label={props.t('forms.transaction.description')}
        value={props.description}
        onChangeText={props.onChangeDescription}
        onBlur={props.onBlurDescription}
        editable={!props.isReadOnly}
        placeholder={props.descriptionPlaceholder}
      />

      {/* The inline tap-to-fill suggestion row, directly under the
        description field. It hides itself when there is nothing to offer, so it
        is rendered unconditionally here. */}
      {props.descriptionSuggestions}

      <DateTimeRow
        time={props.time}
        onChangeTime={props.onChangeTime}
        maxDate={props.maxDate}
        disabled={props.isReadOnly}
        dateTestID="transaction-date-field"
        timeTestID="transaction-time-field"
      />
    </>
  );
};

export default FieldGroup;
