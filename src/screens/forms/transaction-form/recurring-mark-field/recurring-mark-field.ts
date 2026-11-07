import { settingsRepo } from '@kiko/settings';
import type { Currency } from '@kiko/currency/currency';
import type { RecurringMark, RecurringPeriod } from '@kiko/recurring/detection';
import { merchantNameOf, merchantSpellingOf } from '@kiko/transactions/merchant-name';

export type MarkOption = 'none' | RecurringPeriod;

type MarkWrite = {
  row: { id: string; amountMinorUnits: number; description: string };
  currency: Currency;
  chain: { marks: readonly RecurringMark[] } | null;
  option: MarkOption;
};

/**
 * The stored row the form offers the mark field on: none while converting (a convert has no mark)
 * and none for a debit that paid for an exchange purchase, which a series never counts. The
 * caption is read from the screen, which holds the one funding read; this keeps the gate out of
 * the screen's own branch count.
 */
export const markableRowOf = <Row>(
  existing: Row | undefined,
  converting: boolean,
  fundingCaptionKey: string | undefined,
): Row | undefined => (converting || fundingCaptionKey !== undefined ? undefined : existing);

/**
 * What a pick writes. A row inside a marked chain rewrites that chain's period or removes its
 * marks; a row in no marked chain adds its own mark, and "Not marked" there has nothing to remove.
 * The key and the amount come from the stored row, so an unsaved draft never reaches the store.
 */
export const writeMark = ({ row, currency, chain, option }: MarkWrite): Promise<void> => {
  const { key } = merchantNameOf(row.description);

  if (chain !== null) {
    return option === 'none'
      ? settingsRepo.removeRecurringMarks(key, chain.marks)
      : settingsRepo.setRecurringChainPeriod(key, chain.marks, option);
  }

  if (option === 'none') {
    return Promise.resolve();
  }

  return settingsRepo.markRecurringCharge(key, merchantSpellingOf(row.description), {
    currency,
    amountMinorUnits: Math.abs(row.amountMinorUnits),
    period: option,
    transactionId: row.id,
  });
};
