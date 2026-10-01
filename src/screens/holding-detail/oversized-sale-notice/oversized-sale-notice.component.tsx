import type { FC } from 'react';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { useTranslation } from 'react-i18next';
import { asLots, hasNegativeHolding } from '@kiko/holdings/lots';
import NoticeBanner from '@kiko/design-system/components/notice-banner';

import type { OversizedSaleNoticeProps } from './oversized-sale-notice.props';

// Only these types show their lots as rows with their own Edit and Delete,
// the one way to fix a sale.
const LOT_ROW_TYPES: readonly HoldingRow['type'][] = ['share', 'metal'];

const hasOversizedSale = ({
  type,
  metadata,
}: NonNullable<OversizedSaleNoticeProps['holding']>): boolean =>
  LOT_ROW_TYPES.includes(type) &&
  (foldMap(maybe(asLots(isRecord(metadata) ? metadata.lots : undefined)), hasNegativeHolding) ??
    false);

// An older build let a sale larger than what was held before it through, and
// the app-open recost leaves such lots as stored, so their costs stay stale
// until the user edits or deletes that sale (which re-costs every lot).
const OversizedSaleNotice: FC<OversizedSaleNoticeProps> = ({ holding }) => {
  const { t } = useTranslation();

  if (!(foldMap(maybe(holding), hasOversizedSale) ?? false)) {
    return null;
  }

  return <NoticeBanner message={t('holdingDetail.oversizedSale')} testID="oversized-sale-notice" />;
};

export default OversizedSaleNotice;
