import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { currencySymbol } from '@kiko/currency/currency';
import Divider from '@kiko/design-system/components/divider';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import OwnershipField from '@kiko/screens/forms/ownership-field';

import PropertySection from '../property-section';
import { fieldErrorMessage } from '../../field-error-message';

import type { PropertyFormBlockProps } from './property-form-block.props';

// The `type === 'property_item'` details block as its own leaf component,
// keeping its own cognitive-complexity budget separate from the screen's.
// The category select lives in the Type slot (`PropertyTypeField`, on
// `HoldingFormScreen`), not here. The Cost field is CREATE-only; the
// ownership share shows on create AND edit, for every category but a loan
// given — so an edited loan given has nothing to show, and the whole block
// (including its own "Details" heading) renders nothing.
const PropertyFormBlock: FC<PropertyFormBlockProps> = ({ fields, attemptedSave, isEdit }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs, ownership } = fields;

  if (isEdit && !ownership.applies) {
    return null;
  }

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      {!isEdit && (
        <PropertySection
          cost={fields.cost}
          onChangeCost={(text) => fields.setCost(groupAmount(text))}
          currencySuffix={currencySymbol[fields.currency]}
          costError={fieldErrorMessage(t, attemptedSave, fieldErrors.costError)}
          costFieldRef={refs.costFieldRef}
          costInputRef={refs.costInputRef}
        />
      )}

      {ownership.applies && (
        <OwnershipField
          mode={ownership.mode}
          onSelectMode={ownership.setMode}
          percent={ownership.percent}
          onChangePercent={ownership.setPercent}
          numerator={ownership.numerator}
          onChangeNumerator={ownership.setNumerator}
          denominator={ownership.denominator}
          onChangeDenominator={ownership.setDenominator}
          showsEffectiveDate={ownership.showsEffectiveDate}
          effectiveDate={ownership.effectiveDate}
          onChangeEffectiveDate={ownership.setEffectiveDate}
          error={fieldErrorMessage(t, attemptedSave, fieldErrors.ownershipError)}
          fieldRef={refs.ownershipFieldRef}
          inputRef={refs.ownershipInputRef}
        />
      )}
    </Box>
  );
};

export default PropertyFormBlock;
