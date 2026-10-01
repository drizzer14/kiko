import type { FC } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { asShareMeta } from '@kiko/holdings/holding-metadata';
import NoticeBanner from '@kiko/design-system/components/notice-banner';
import { isShareUnitSupported, unitHoldingCurrency } from '@kiko/prices/share-search';

import type { ListingCurrencyNoticeProps } from './listing-currency-notice.props';

// The stored listing unit of an EODHD share held in another currency than
// the one that unit fits: the price refresh never stores a close for it.
const mismatchedListingUnit = (
  holding: NonNullable<ListingCurrencyNoticeProps['holding']>,
): string | undefined => {
  const meta = holding.type === 'share' ? asShareMeta(holding.metadata) : null;

  if (meta?.quoteSource !== 'eodhd' || meta.quoteCurrency === undefined) {
    return undefined;
  }

  return unitHoldingCurrency(meta.quoteCurrency) === holding.currency
    ? undefined
    : meta.quoteCurrency;
};

// A share stored in another currency than its EODHD listing (an older build
// let one through) keeps its cost as its value. Its currency cannot change,
// so the notice names both ways out: Manual keeps the cost, or a new share.
// A unit no share currency fits leaves only Manual.
const ListingCurrencyNotice: FC<ListingCurrencyNoticeProps> = ({ holding }) => {
  const { t } = useTranslation();
  const unit = foldMap(maybe(holding), mismatchedListingUnit);

  if (unit === undefined) {
    return null;
  }

  const currency = unitHoldingCurrency(unit);

  return (
    <NoticeBanner
      message={
        isShareUnitSupported(unit)
          ? t('holdingDetail.listingCurrencyMismatch', { currency })
          : t('holdingDetail.listingCurrencyUnsupported', { currency })
      }
      testID="listing-currency-notice"
    />
  );
};

export default ListingCurrencyNotice;
