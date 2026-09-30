import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import DateField from '@kiko/screens/forms/date-field';
import TextField from '@kiko/design-system/components/text-field';
import FieldLabel from '@kiko/design-system/components/field-label';
import SegmentedControl from '@kiko/design-system/components/segmented-control';
import { shareQuoteSources, type ShareQuoteSource } from '@kiko/holdings/holding-metadata';

import type { ShareSectionProps } from './share-section.props';

const quoteSourceLabels = (t: TFunction): Record<ShareQuoteSource, string> => ({
  eodhd: t('forms.holding.sharePriceSourceEodhd'),
  manual: t('forms.holding.isinModeManual'),
});

// The `share` form section. The price source changes which fields show (the
// ticker is EODHD-only), so it is a `SegmentedControl`, with its own
// `FieldLabel` above, like the bond ISIN/Manual mode. Purely presentational:
// `useShareFields` owns every value and validation.
const ShareSection: FC<ShareSectionProps> = ({
  quoteSource,
  onSelectQuoteSource,
  ticker,
  onChangeTicker,
  tickerError,
  tickerFieldRef,
  tickerInputRef,
  hasEodhdKey,
  isin,
  onChangeIsin,
  isinError,
  isinFieldRef,
  isinInputRef,
  showFirstLot,
  quantity,
  onChangeQuantity,
  cost,
  onChangeCost,
  currencySuffix,
  purchaseDate,
  onChangePurchaseDate,
  quantityError,
  costError,
  quantityFieldRef,
  quantityInputRef,
  costFieldRef,
  costInputRef,
}) => {
  const { t } = useTranslation();

  return (
    <Box gap={4}>
      <Box gap={1} testID="share-price-source">
        <FieldLabel label={t('forms.holding.sharePriceSource')} />

        <SegmentedControl<ShareQuoteSource>
          options={shareQuoteSources}
          selected={quoteSource}
          onSelect={onSelectQuoteSource}
          labels={quoteSourceLabels(t)}
          accessibilityLabel={t('forms.holding.sharePriceSource')}
          testID="share-price-source-control"
        />
      </Box>

      {quoteSource === 'eodhd' && (
        <View ref={tickerFieldRef}>
          <TextField
            label={t('forms.holding.shareTicker')}
            value={ticker}
            onChangeText={onChangeTicker}
            placeholder={t('forms.holding.shareTickerPlaceholder')}
            autoCapitalize="characters"
            autoCorrect={false}
            required
            error={tickerError}
            inputRef={tickerInputRef}
          />
        </View>
      )}

      {quoteSource === 'eodhd' && !hasEodhdKey && (
        <Text variant="caption" tone="textSecondary">
          {t('forms.holding.shareNoKeyHint')}
        </Text>
      )}

      <View ref={isinFieldRef}>
        <TextField
          label={t('forms.holding.isin')}
          value={isin}
          onChangeText={onChangeIsin}
          placeholder={t('forms.holding.isinPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          error={isinError}
          inputRef={isinInputRef}
        />
      </View>

      {showFirstLot && (
        <>
          <View ref={quantityFieldRef}>
            <TextField
              label={t('forms.holding.quantity')}
              value={quantity}
              onChangeText={onChangeQuantity}
              keyboardType="decimal-pad"
              placeholder={t('forms.holding.quantityPlaceholder')}
              required
              error={quantityError}
              inputRef={quantityInputRef}
            />
          </View>

          <View ref={costFieldRef}>
            <TextField
              label={t('forms.lot.totalCost')}
              value={cost}
              onChangeText={onChangeCost}
              keyboardType="decimal-pad"
              placeholder={t('forms.lot.totalCostPlaceholder')}
              suffix={currencySuffix}
              required
              error={costError}
              inputRef={costInputRef}
            />
          </View>

          <DateField
            label={t('forms.holding.purchaseDate')}
            sheetTitle={t('forms.holding.purchaseDateSheetTitle')}
            value={purchaseDate}
            onChange={onChangePurchaseDate}
            placeholder={t('forms.fields.selectDatePlaceholder')}
            required
          />
        </>
      )}
    </Box>
  );
};

export default ShareSection;
