import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { isCurrency } from '@kiko/currency/currency';
import type { RecurringMark } from '@kiko/recurring/detection';
import { RECURRING_PERIODS, compareMarks, periodRankOf } from '@kiko/recurring/recurring-periods';

/**
 * What the user chose for one merchant key: the last spelling they saw, that its detected series
 * stay out of the list, and the chains they marked as recurring. Each part is read and cleared on
 * its own; an entry holding neither is not stored.
 */
export type RecurringMerchantChoice = {
  name: string;
  hidden?: true;
  marks?: RecurringMark[];
};

/** Whether two marks select the same chain: its currency and amount, never its period. */
export const isSameChain = (mark: RecurringMark, other: RecurringMark): boolean =>
  mark.currency === other.currency && mark.amountMinorUnits === other.amountMinorUnits;

/** The one place that decides an entry with neither a hide nor a mark is no entry. */
export const recurringChoiceOf = (
  name: string,
  { isHidden, marks }: { isHidden: boolean; marks: readonly RecurringMark[] },
): RecurringMerchantChoice | null =>
  isHidden || marks.length > 0
    ? {
        name,
        ...(isHidden ? { hidden: true as const } : {}),
        ...(marks.length > 0 ? { marks: [...marks] } : {}),
      }
    : null;

const markOf = (stored: unknown): RecurringMark[] => {
  if (!isRecord(stored)) {
    return [];
  }

  const { currency, amountMinorUnits, period } = stored;
  const knownPeriod = RECURRING_PERIODS.find((known) => known === period);

  return typeof currency === 'string' &&
    isCurrency(currency) &&
    knownPeriod !== undefined &&
    typeof amountMinorUnits === 'number' &&
    Number.isSafeInteger(amountMinorUnits) &&
    amountMinorUnits > 0
    ? [{ currency, amountMinorUnits, period: knownPeriod }]
    : [];
};

/**
 * Keeps one mark per currency and amount, the earlier period of the picker's order, and sorts by
 * amount, that order and currency, so no stored order changes what is read.
 */
const marksOf = (stored: unknown): RecurringMark[] => {
  const chains = new Map<string, RecurringMark>();

  for (const mark of Array.isArray(stored) ? stored.flatMap(markOf) : []) {
    const chain = `${mark.currency}:${mark.amountMinorUnits}`;
    const kept = chains.get(chain);

    if (kept === undefined || periodRankOf(mark.period) < periodRankOf(kept.period)) {
      chains.set(chain, mark);
    }
  }

  return [...chains.values()].sort(compareMarks);
};

const choiceOf = (entry: unknown): RecurringMerchantChoice[] =>
  isRecord(entry) && typeof entry.name === 'string'
    ? (foldMap(
        maybe(
          recurringChoiceOf(entry.name, {
            isHidden: entry.hidden === true,
            marks: marksOf(entry.marks),
          }),
        ),
        (choice) => [choice],
      ) ?? [])
    : [];

/**
 * Reads the stored column. Keys are user text (`constructor`, `__proto__` are real keys), so the
 * result is a `Map` and nothing indexes the stored object. Anything that is not an object reads
 * as no choice, and an entry without a string `name`, or with neither `hidden: true` nor a good
 * mark, is dropped alone, as is each bad mark.
 */
export const recurringMerchantChoicesOf = (
  stored: unknown,
): ReadonlyMap<string, RecurringMerchantChoice> =>
  new Map(
    isRecord(stored)
      ? Object.entries(stored).flatMap(([key, entry]) =>
          choiceOf(entry).map((choice) => [key, choice] as const),
        )
      : [],
  );
