import {
  type ChargeGroup,
  type ChargeGroups,
  type DetectedPeriod,
  type RecurringMark,
  type RecurringPeriod,
  type RecurringSeries,
  groupKeyOf,
  seriesOfGroups,
} from '@kiko/recurring/detection';
import {
  type MarkedEntry,
  markedSeriesOf,
  detectedBesideMarked,
} from '@kiko/recurring/marked-series';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import type { RecurringMerchantChoice } from '@kiko/settings';

type Choices = ReadonlyMap<string, RecurringMerchantChoice>;

export type RowRecurrence =
  | { kind: 'marked'; period: RecurringPeriod; marks: readonly RecurringMark[] }
  | { kind: 'detected'; period: DetectedPeriod }
  | { kind: 'none' };

/** What detection found in the one group of a row: the group alone, and its detected series. */
type RowDetection = { chargeGroups: ChargeGroups; detected: RecurringSeries[] };

type RowDetectionInput = {
  chargeGroups: ChargeGroups;
  key: string;
  currency: Currency;
  today: number;
};

type RowChoicesInput = { key: string; rowId: string; choices: Choices; today: number };

const NONE: RowRecurrence = { kind: 'none' };

export const markedEntriesOf = (choices: Choices): MarkedEntry[] =>
  [...choices].flatMap(([key, { name, marks = [] }]) =>
    marks.length > 0 ? [{ key, name, marks }] : [],
  );

const isDetectedPeriod = (period: RecurringPeriod): period is DetectedPeriod =>
  period === 'weekly' || period === 'monthly' || period === 'yearly';

const holdingRow =
  (rowId: string) =>
  ({ chargeIds }: RecurringSeries): boolean =>
    chargeIds.includes(rowId);

/**
 * The series rule on the group of one row alone. `seriesOfGroups` maps each group on its own, so
 * the one group gives that group's series exactly, and a whole ledger's other groups cost nothing.
 * It does not read the merchant choices, so a hide or a mark write never has to run it again.
 */
export const rowDetectionOf = ({
  chargeGroups,
  key,
  currency,
  today,
}: RowDetectionInput): RowDetection => {
  const groupKey = groupKeyOf(key, currency);
  const alone: ChargeGroups = {
    groups: new Map(
      foldMap(maybe(chargeGroups.groups.get(groupKey)), (group): [string, ChargeGroup][] => [
        [groupKey, group],
      ]) ?? [],
    ),
    newestTimeByHoldingId: chargeGroups.newestTimeByHoldingId,
  };

  return { chargeGroups: alone, detected: seriesOfGroups(alone, today) };
};

/**
 * What the merchant choices make of a row's detection: the marked chain of its key that holds it,
 * else the detected series that holds it, unless the key is hidden. A marked chain wins the rows it
 * holds, and a hide drops detected series only.
 */
export const rowRecurrenceFromDetection = (
  { chargeGroups, detected }: RowDetection,
  { key, rowId, choices, today }: RowChoicesInput,
): RowRecurrence => {
  const marked = markedSeriesOf(
    chargeGroups,
    markedEntriesOf(choices).filter((entry) => entry.key === key),
    today,
  ).series;
  const shown = choices.get(key)?.hidden === true ? [] : detectedBesideMarked(detected, marked);

  return (
    foldMap(
      maybe(marked.find(holdingRow(rowId))),
      ({ period, marks = [] }): RowRecurrence => ({ kind: 'marked', period, marks }),
    ) ??
    foldMap(
      maybe(shown.find(holdingRow(rowId))),
      ({ period }): RowRecurrence =>
        isDetectedPeriod(period) ? { kind: 'detected', period } : NONE,
    ) ??
    NONE
  );
};

/**
 * What the series list shows for one row, found without the list: both screens give a row the same
 * answer. It is the two steps in a row; the form runs the first on a ledger fire only and the
 * second on a settings fire.
 */
export const rowRecurrenceOf = ({
  chargeGroups,
  key,
  currency,
  rowId,
  choices,
  today,
}: RowDetectionInput & Omit<RowChoicesInput, 'key' | 'today'>): RowRecurrence =>
  rowRecurrenceFromDetection(rowDetectionOf({ chargeGroups, key, currency, today }), {
    key,
    rowId,
    choices,
    today,
  });
