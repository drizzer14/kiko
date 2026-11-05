import { isRecord } from '@kiko/type-guards';

/**
 * What the user chose for one merchant key: the last spelling they saw and that its detected
 * series stay out of the list.
 */
export type RecurringMerchantChoice = { name: string; hidden: true };

const choiceOf = (entry: unknown): RecurringMerchantChoice[] =>
  isRecord(entry) && typeof entry.name === 'string' && entry.hidden === true
    ? [{ name: entry.name, hidden: true }]
    : [];

/**
 * Reads the stored column. Keys are user text (`constructor`, `__proto__` are real keys), so the
 * result is a `Map` and nothing indexes the stored object. Anything that is not an object reads
 * as no choice, and an entry without a string `name` and `hidden: true` is dropped alone.
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
