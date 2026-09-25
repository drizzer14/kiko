import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import MetalSection from '../metal-section';
import Box from '../../../../../design-system/components/box';
import { fieldErrorMessage } from '../../field-error-message';
import Text from '../../../../../design-system/components/text';
import { currencySymbol } from '../../../../../currency/currency';
import { groupAmount } from '../../../amount-format/amount-format';
import Divider from '../../../../../design-system/components/divider';

import type { MetalFormBlockProps } from './metal-form-block.props';

// The `type === 'metal'` details block as its own leaf component, mirroring
// `PropertyFormBlock`'s own extraction — kept out of the
// already-at-the-ceiling screen's own cognitive-complexity budget. The
// screen itself still gates this on `type === 'metal'`, so this component
// always renders once mounted.
const MetalFormBlock: FC<MetalFormBlockProps> = ({ fields, attemptedSave, isEdit }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <MetalSection
        metal={fields.metal}
        onSelectMetal={fields.setMetal}
        form={fields.form}
        onSelectForm={fields.setForm}
        unit={fields.unit}
        onSelectUnit={fields.setUnit}
        purity={fields.purity}
        onChangePurity={fields.setPurity}
        purityError={fieldErrorMessage(t, attemptedSave, fieldErrors.purityError)}
        purityFieldRef={refs.purityFieldRef}
        purityInputRef={refs.purityInputRef}
        showFirstLot={!isEdit}
        quantity={fields.quantity}
        onChangeQuantity={(text) => fields.setQuantity(groupAmount(text))}
        cost={fields.cost}
        onChangeCost={(text) => fields.setCost(groupAmount(text))}
        currencySuffix={currencySymbol.UAH}
        quantityError={fieldErrorMessage(t, attemptedSave, fieldErrors.quantityError)}
        costError={fieldErrorMessage(t, attemptedSave, fieldErrors.costError)}
        quantityFieldRef={refs.quantityFieldRef}
        quantityInputRef={refs.quantityInputRef}
        costFieldRef={refs.costFieldRef}
        costInputRef={refs.costInputRef}
      />
    </Box>
  );
};

export default MetalFormBlock;
