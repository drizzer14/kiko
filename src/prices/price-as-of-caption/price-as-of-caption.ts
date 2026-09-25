import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { holdingDescriptorOrUndefined } from '@kiko/holdings/holding-descriptor';

import { formatDate } from '../../dates/format';
import type { HoldingRow } from '../../db/schema';
import { type PriceBook, latestPoint } from '../price-book';

/**
 * The "Value as of <date>" / "Price as of <date>" caption for a priced
 * holding (a non-null `priced` spec on its own descriptor —
 * `src/holdings/holding-descriptor/`): the LATEST stored price point's own
 * day, so the user sees how current the figure is. `undefined` for a
 * non-priced holding, or a priced one with no stored point yet (its value
 * still falls back to cost basis — `kiko-domain`). `point.day` is a
 * UTC-midnight epoch standing for a LOCAL calendar day (`dayKeyOf`'s
 * convention), so it is formatted with the matching `{ timeZone: 'UTC' }`
 * option — reading it with the LOCAL getters could land on the previous
 * calendar day in a negative-UTC-offset timezone. The wording itself
 * (`captionKey`) and which instrument it reads (`captionInstrument`) are each
 * type's own choice, kept on its descriptor's `priced` spec.
 *
 * The ONE shared implementation `holding-detail.screen.tsx` and
 * `holding-card.component.tsx` both import — a per-call-site copy of this
 * logic risks the two silently drifting apart (a holding-type branch present
 * in one but not the other), so this stays a single source of truth rather
 * than being inlined at either call site.
 */
export const priceAsOfCaption = (
  holding: HoldingRow | undefined,
  priceBook: PriceBook,
  t: TFunction,
): string | undefined => {
  if (holding === undefined) {
    return undefined;
  }

  const priced = holdingDescriptorOrUndefined(holding.type)?.priced;
  if (priced === undefined || priced === null) {
    return undefined;
  }

  const instrument = priced.captionInstrument(holding);
  const point = foldMap(maybe(instrument), (found) => latestPoint(priceBook, found));

  return foldMap(maybe(point), (found) =>
    t(priced.captionKey, { date: formatDate(found.day, { timeZone: 'UTC' }) }),
  );
};
