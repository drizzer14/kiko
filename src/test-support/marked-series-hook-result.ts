import {
  type MarkedEntry,
  markedSeriesOf,
  detectedBesideMarked,
} from '@kiko/recurring/marked-series';
import type { RecurringMerchantChoice } from '@kiko/settings';
import { chargeGroupsOf, seriesOfGroups } from '@kiko/recurring/detection';

import { type Ledger, nowOf } from './recurring-ledger';
import { entryOf, type MarkSpec } from './marked-series-world';

/** A name and the marks stored under it, in major units. */
export type MarkedNames = [name: string, ...marks: MarkSpec[]];

/**
 * What the series hook hands its screens for a ledger and the marked entries stored beside it,
 * made of the real detection and marked functions: `series` is the detected series that share no
 * row with a marked one, and the marked ones and the chains without a charge come apart.
 */
export const hookResultOf = (ledger: Ledger, entries: readonly MarkedEntry[]) => {
  const today = nowOf();
  const groups = chargeGroupsOf(ledger, today);
  const { series: markedSeries, withoutCharges } = markedSeriesOf(groups, entries, today);

  return {
    series: detectedBesideMarked(seriesOfGroups(groups, today), markedSeries),
    markedSeries,
    withoutCharges,
  };
};

/** The hook's whole return for a screen test, from the names marked in a ledger. */
export const hookStateOf = (
  ledger: Ledger,
  marked: readonly MarkedNames[],
  choices: ReadonlyMap<string, RecurringMerchantChoice> = new Map(),
) => ({
  ...hookResultOf(
    ledger,
    marked.map(([name, ...specs]) => entryOf(name, specs)),
  ),
  isLoading: false,
  choices,
});
