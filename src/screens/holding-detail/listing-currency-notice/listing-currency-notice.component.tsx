import type { FC } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { asShareMeta } from '@kiko/holdings/holding-metadata';
import { unitHoldingCurrency } from '@kiko/prices/share-search';
import NoticeBanner from '@kiko/design-system/components/notice-banner';

import type { ListingCurrencyNoticeProps } from './listing-currency-notice.props';

// The currency an EODHD share's stored listing unit fits, when the share is
// held in another one: the price refresh never stores a close for it.
const mismatchedListingCurrency = (
  holding: NonNullable<ListingCurrencyNoticeProps['holding']>,
): string | undefined => {
  const meta = holding.type === 'share' ? asShareMeta(holding.metadata) : null;

  if (meta?.quoteSource !== 'eodhd' || meta.quoteCurrency === undefined) {
    return undefined;
  }

  const listingCurrency = unitHoldingCurrency(meta.quoteCurrency);

  return listingCurrency === holding.currency ? undefined : listingCurrency;
};

// A share stored in another currency than its EODHD listing (an older build
// let one through) keeps its cost as its value. Its currency cannot change,
// so the notice names both ways out: Manual keeps the cost, or a new share.
const ListingCurrencyNotice: FC<ListingCurrencyNoticeProps> = ({ holding }) => {
  const { t } = useTranslation();
  const currency = foldMap(maybe(holding), mismatchedListingCurrency);

  if (currency === undefined) {
    return null;
  }

  return (
    <NoticeBanner
      message={t('holdingDetail.listingCurrencyMismatch', { currency })}
      testID="listing-currency-notice"
    />
  );
};

export default ListingCurrencyNotice;
