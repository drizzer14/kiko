import { View } from 'react-native';
import type { ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import Divider from '@kiko/design-system/components/divider';
import TextField from '@kiko/design-system/components/text-field';
import FieldError from '@kiko/design-system/components/field-error';
import HoldingSelectField from '@kiko/screens/forms/holding-select-field';

import type { SplitReturnsProps } from './split-returns.props';

// Split-change mode's dynamic section, rendered BELOW the reused Amount/
// Description/Date/Time group (income/expense's own field group already renders
// for split, since split is neither exchange nor converting): one row per
// change-return — a holding picker + a payer-currency amount field + a tonal
// Remove button — followed by an "Add return" action. A component of its own
// for the same cognitive-complexity-budget reason as `FieldGroup`.
const SplitReturns = (props: SplitReturnsProps): ReactElement | null => {
  if (!props.visible) {
    return null;
  }

  const invalid = props.error !== undefined;

  return (
    <>
      {/* A divider + title-case section heading mark where the change-returns
        list begins, the same shared Divider + `variant="heading"` Text
        the term-deposit contributions section uses. */}
      <Divider testID="returns-divider" />

      <Text variant="heading">{props.t('forms.transaction.returnsHeading')}</Text>

      {props.returns.map((row, index) => (
        <View
          key={row.id}
          // Only the LAST row anchors `lastRowRef` (the
          // add-row scroll target) — `undefined` on every earlier row, the
          // same single-target-ref shape `contributionsFieldRef`'s own
          // index-gated assignment uses in holding-form.
          ref={index === props.returns.length - 1 ? props.lastRowRef : undefined}
        >
          <Box gap={2}>
            <HoldingSelectField
              label={props.t('forms.transaction.returnTo', { index: index + 1 })}
              sheetTitle={props.t('forms.transaction.returnToSheetTitle', { index: index + 1 })}
              placeholder={props.selectHoldingPlaceholder}
              options={props.buildOptions(index)}
              selectedId={row.holdingId}
              onSelect={(holdingId) => props.onSelectHolding(index, holdingId)}
              onCreateNew={props.onCreateHolding}
              required
              invalid={invalid}
            />

            <TextField
              label={props.t('forms.transaction.returnAmount', { index: index + 1 })}
              value={row.amount}
              onChangeText={(text) => props.onChangeAmount(index, text)}
              keyboardType="decimal-pad"
              placeholder={props.t('forms.transaction.amountPlaceholder')}
              suffix={props.suffix}
              required
              invalid={invalid}
            />

            {/* The delete-return control reuses the SAME shared Button the deposit
              (term-deposit contributions) form uses for its remove action — a
              destructiveTonal small button WITH a text label, never a hand-rolled
              icon-only button. Gated on more than one return, mirroring the
              contributions list's own guard, so the last remaining split return
              cannot be deleted. */}
            {props.returns.length > 1 && (
              <Button
                variant="destructiveTonal"
                size="small"
                fullWidth={false}
                icon="trash"
                accessibilityLabel={props.t('forms.transaction.removeReturn', { index: index + 1 })}
                onPress={() => props.onRemove(index)}
              >
                {props.t('forms.transaction.remove')}
              </Button>
            )}
          </Box>
        </View>
      ))}

      {props.error !== undefined && <FieldError message={props.error} />}

      <Button
        variant="secondaryTonal"
        size="small"
        fullWidth={false}
        icon="plus"
        onPress={props.onAdd}
      >
        {props.t('forms.transaction.addReturn')}
      </Button>
    </>
  );
};

export default SplitReturns;
