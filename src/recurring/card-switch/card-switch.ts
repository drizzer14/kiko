import {
  type ChargeGroups,
  type RecurringSeries,
  byNewestCharge,
  compareText,
  groupKeyOf,
} from '@kiko/recurring/detection';
import maybe, { foldMap } from 'fnts/maybe';
import { startOfLocalDay } from '@kiko/dates';

type Started = { series: RecurringSeries; firstChargeTime: number };

// The earliest charge's id is the series id, so its time is read from the series' own group.
const firstChargeTimeOf = (
  { id, merchantKey, currency }: RecurringSeries,
  { groups }: ChargeGroups,
): number | undefined =>
  groups.get(groupKeyOf(merchantKey, currency))?.charges.find((charge) => charge.id === id)?.time;

const byFirstCharge = (left: Started, right: Started): number =>
  left.firstChargeTime - right.firstChargeTime || compareText(left.series.id, right.series.id);

// Each part stopped on an earlier local day than the next began: the same day is an overlap.
const isCardSwitch = (oldestFirst: readonly Started[]): boolean =>
  oldestFirst.length > 1 &&
  new Set(oldestFirst.map(({ series }) => series.currency)).size === oldestFirst.length &&
  oldestFirst.every(({ series }, index) => {
    const next = oldestFirst[index + 1];

    return (
      next === undefined ||
      startOfLocalDay(series.lastChargeTime) < startOfLocalDay(next.firstChargeTime)
    );
  });

const partOf = ({ id, currency, chargeIds }: RecurringSeries) => ({ id, currency, chargeIds });

// The newest part's fields stand, the oldest part's id stays, and no charge moves out of its part.
const joinedOf = (oldest: RecurringSeries, newerFirst: readonly RecurringSeries[]) =>
  newerFirst.reduce<RecurringSeries>(
    (joined, newer) => ({
      ...newer,
      id: joined.id,
      chargeIds: [...newer.chargeIds, ...joined.chargeIds],
      parts: [partOf(newer), ...(joined.parts ?? [])],
    }),
    { ...oldest, parts: [partOf(oldest)] },
  );

const joinedOrAsIs = (
  group: readonly RecurringSeries[],
  chargeGroups: ChargeGroups,
): RecurringSeries[] => {
  const started = group.flatMap(
    (series) =>
      foldMap(maybe(firstChargeTimeOf(series, chargeGroups)), (firstChargeTime) => [
        { series, firstChargeTime },
      ]) ?? [],
  );
  const [oldest, ...newer] = [...started].sort(byFirstCharge);

  return started.length === group.length && oldest !== undefined && isCardSwitch([oldest, ...newer])
    ? [
        joinedOf(
          oldest.series,
          newer.map(({ series }) => series),
        ),
      ]
    : [...group];
};

/**
 * The shown detected series, with the series of one name and period that ran one after the other
 * in different currencies (a card switch) joined into one row: the newest part's fields, the
 * charges of every part, and `parts` newest first. All or nothing per name and period: two series
 * in one currency, or any overlap, keep every series of it apart. A marked series is never given
 * here. The output order does not depend on the input order.
 */
export const cardSwitchesJoinedOf = (
  detected: readonly RecurringSeries[],
  chargeGroups: ChargeGroups,
): RecurringSeries[] => {
  const byNamePeriod = new Map<string, RecurringSeries[]>();

  detected.forEach((series) => {
    const key = JSON.stringify([series.merchantKey, series.period]);

    byNamePeriod.set(key, [...(byNamePeriod.get(key) ?? []), series]);
  });

  return [...byNamePeriod.values()]
    .flatMap((group) => joinedOrAsIs(group, chargeGroups))
    .sort(byNewestCharge);
};
