import type { TFunction } from 'i18next';

import { formatDate } from '../../dates/format';
import type { HoldingRow } from '../../db/schema';
import { type PriceBook, latestPoint } from '../price-book';
import { asMetalMeta } from '../../holdings/holding-metadata';
import { isPricedHoldingType } from '../../holdings/priced-value';
import { metalInstrument, holdingInstrument } from '../instrument';

/**
 * The "Value as of <date>" / "Price as of <date>" caption for a priced
 * holding (`isPricedHoldingType`): the LATEST stored price point's own day,
 * so the user sees how current the figure is. `undefined` for a non-priced
 * holding, or a priced one with no stored point yet (its value still falls
 * back to cost basis — `kiko-domain`). `point.day` is a UTC-midnight epoch
 * standing for a LOCAL calendar day (`dayKeyOf`'s convention), so it is
 * formatted with the matching `{ timeZone: 'UTC' }` option — reading it with
 * the LOCAL getters could land on the previous calendar day in a
 * negative-UTC-offset timezone.
 *
 * `metal` (T20) reads a DIFFERENT instrument than every other priced type: it
 * shares `metal:<XAU|...>` across every holding of that metal (kiko-pricing),
 * never a per-holding `holding:<id>` series the way `property_item` uses —
 * and carries its own wording ("Price as of") since it is the metal's market
 * price, not a per-holding manual revaluation. An invalid/absent MetalMeta
 * resolves no instrument, matching the "no stored point yet" case below.
 *
 * Extracted (F4 audit 13) out of `holding-detail.screen.tsx` into ONE shared
 * helper both `holding-detail.screen.tsx` and `holding-card.component.tsx`
 * import — the two used to carry independently hand-copied versions, and the
 * card's own copy had silently drifted to DROP the metal branch entirely, so
 * a metal holding's card never showed ANY "as of" caption (its
 * `holding:<id>` instrument never resolves for a metal — only the shared
 * `metal:<slug>` one does).
 */
export const priceAsOfCaption = (
  holding: HoldingRow | undefined,
  priceBook: PriceBook,
  t: TFunction,
): string | undefined => {
  if (holding === undefined || !isPricedHoldingType(holding.type)) {
    return undefined;
  }

  if (holding.type === 'metal') {
    const meta = asMetalMeta(holding.metadata);
    const point = meta === null ? undefined : latestPoint(priceBook, metalInstrument(meta.metal));

    return point === undefined
      ? undefined
      : t('holdingDetail.priceAsOf', { date: formatDate(point.day, { timeZone: 'UTC' }) });
  }

  const point = latestPoint(priceBook, holdingInstrument(holding.id));

  return point === undefined
    ? undefined
    : t('holdingDetail.valueAsOf', { date: formatDate(point.day, { timeZone: 'UTC' }) });
};
