import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { currencySymbol } from '@kiko/currency/currency';
import Divider from '@kiko/design-system/components/divider';
import { groupAmount } from '@kiko/screens/forms/amount-format';

import ShareSection from '../share-section';
import { fieldErrorMessage } from '../../field-error-message';

import type { ShareFormBlockProps } from './share-form-block.props';

// The `type === 'share'` details block as its own leaf component, keeping
// its own cognitive-complexity budget separate from the screen's.
const ShareFormBlock: FC<ShareFormBlockProps> = ({ fields, attemptedSave, isEdit, currency }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <ShareSection
        quoteSource={fields.quoteSource}
        onSelectQuoteSource={fields.setQuoteSource}
        ticker={fields.ticker}
        onChangeTicker={fields.setTicker}
        tickerError={fieldErrorMessage(t, attemptedSave, fieldErrors.tickerError)}
        tickerFieldRef={refs.tickerFieldRef}
        tickerInputRef={refs.tickerInputRef}
        hasEodhdKey={fields.hasEodhdKey}
        isin={fields.isin}
        onChangeIsin={fields.setIsin}
        isinError={fieldErrorMessage(t, attemptedSave, fieldErrors.isinError)}
        isinFieldRef={refs.isinFieldRef}
        isinInputRef={refs.isinInputRef}
        showFirstLot={!isEdit}
        quantity={fields.quantity}
        onChangeQuantity={(text) => fields.setQuantity(groupAmount(text))}
        cost={fields.cost}
        onChangeCost={(text) => fields.setCost(groupAmount(text))}
        currencySuffix={currencySymbol[currency]}
        purchaseDate={fields.purchaseDate}
        onChangePurchaseDate={fields.setPurchaseDate}
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

export default ShareFormBlock;
