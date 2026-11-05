import {
  type Charge,
  type ChargeGroups,
  type RecurringMark,
  type RecurringPeriod,
  type RecurringSeries,
  foldTwins,
  groupKeyOf,
  compareText,
  byNewestCharge,
  amountPiecesOf,
  seriesOfCharges,
  markedRecurrenceOf,
} from '@kiko/recurring/detection';
import maybe, { foldMap } from 'fnts/maybe';
import { maxOf, minOf } from '@kiko/numbers';
import { startOfLocalDay } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import { compareMarks } from '@kiko/recurring/recurring-periods';

export type MarkedEntry = { key: string; name: string; marks: readonly RecurringMark[] };

/** A chain that holds a stored amount and no charge: the user can still remove it. */
export type MarkedChain = {
  key: string;
  name: string;
  currency: Currency;
  period: RecurringPeriod;
  marks: readonly RecurringMark[];
};

type MarkedPiece = {
  lowest: number;
  highest: number;
  period: RecurringPeriod;
  marks: RecurringMark[];
};

type Chain = MarkedPiece & {
  key: string;
  name: string;
  currency: Currency;
  charges: Charge[];
};

// The list's order for chains without a charge, which have no date to sort by.
const byKeyCurrencyAndAmount = (left: MarkedChain, right: MarkedChain): number =>
  compareText(left.key, right.key) ||
  compareText(left.currency, right.currency) ||
  left.marks[0].amountMinorUnits - right.marks[0].amountMinorUnits;

// A stored amount sits in the cut like a charge, with or without a charge at it, so it can bridge
// two charges. A piece that holds no stored amount selects nothing and is dropped. `marks` are
// sorted and of one currency.
const piecesOf = (amounts: readonly number[], marks: readonly RecurringMark[]): MarkedPiece[] =>
  amountPiecesOf([...amounts, ...marks.map(({ amountMinorUnits }) => amountMinorUnits)]).flatMap(
    (piece) => {
      const lowest = minOf(piece);
      const highest = maxOf(piece);
      const inPiece = marks.filter(
        ({ amountMinorUnits }) => amountMinorUnits >= lowest && amountMinorUnits <= highest,
      );

      return (
        foldMap(maybe(inPiece.at(0)), ({ period }) => [
          { lowest, highest, period, marks: inPiece },
        ]) ?? []
      );
    },
  );

const chainsOfEntry = (chargeGroups: ChargeGroups, { key, name, marks }: MarkedEntry): Chain[] => {
  const sorted = [...marks].sort(compareMarks);

  return [...new Set(sorted.map(({ currency }) => currency))].flatMap((currency) => {
    const charges = foldTwins(chargeGroups.groups.get(groupKeyOf(key, currency))?.charges ?? []);

    return piecesOf(
      charges.map(({ amount }) => amount),
      sorted.filter((mark) => mark.currency === currency),
    ).map((piece) => ({
      ...piece,
      key,
      name,
      currency,
      charges: charges.filter(({ amount }) => amount >= piece.lowest && amount <= piece.highest),
    }));
  });
};

const seriesOfChain = (
  { key, currency, charges, period, marks, lowest, highest }: Chain,
  chargeGroups: ChargeGroups,
  today: number,
): RecurringSeries => ({
  ...seriesOfCharges(
    { charges, period, recurrence: markedRecurrenceOf(period, charges) },
    { key, currency },
    chargeGroups,
    today,
  ),
  marks,
  markedSpan: { lowest, highest },
});

/**
 * The charge chain of every stored amount, one series per chain that holds a charge. A mark reads
 * only the group of its own key and currency, so no amount compares across currencies, and no
 * day test decides which charges join. A stored amount alone in its piece selects nothing and
 * comes back as a chain without charges. The output order does not depend on the order of the
 * rows or of the marks.
 */
export const markedSeriesOf = (
  chargeGroups: ChargeGroups,
  entries: readonly MarkedEntry[],
  now: number,
): { series: RecurringSeries[]; withoutCharges: MarkedChain[] } => {
  const today = startOfLocalDay(now);
  const chains = entries.flatMap((entry) => chainsOfEntry(chargeGroups, entry));

  return {
    series: chains
      .filter(({ charges }) => charges.length > 0)
      .map((chain) => seriesOfChain(chain, chargeGroups, today))
      .sort(byNewestCharge),
    withoutCharges: chains
      .filter(({ charges }) => charges.length === 0)
      .map(({ key, name, currency, period, marks }) => ({ key, name, currency, period, marks }))
      .sort(byKeyCurrencyAndAmount),
  };
};

/**
 * The detected series that share no row with a marked one. A marked chain wins the rows it holds,
 * so no charge is in two shown series.
 */
export const detectedBesideMarked = (
  detected: readonly RecurringSeries[],
  marked: readonly RecurringSeries[],
): RecurringSeries[] => {
  const markedIds = new Set(marked.flatMap(({ chargeIds }) => chargeIds));

  return detected.filter(({ chargeIds }) => !chargeIds.some((id) => markedIds.has(id)));
};

/**
 * The marked chain whose lowest and highest amounts span `amountMinorUnits`, or null when the
 * amount lies in no chain that holds a stored amount of `currency`. `charges` are one group's
 * charges as absolute minor units; a twin only repeats an amount, which moves no piece's lowest or
 * highest, so the fold is not needed.
 */
export const markedChainOfAmount = (
  charges: readonly { amountMinorUnits: number }[],
  marks: readonly RecurringMark[],
  amountMinorUnits: number,
  currency: Currency,
): { period: RecurringPeriod; marks: readonly RecurringMark[] } | null => {
  const chain = piecesOf(
    charges.map((charge) => charge.amountMinorUnits),
    marks.filter((mark) => mark.currency === currency).sort(compareMarks),
  ).find(({ lowest, highest }) => amountMinorUnits >= lowest && amountMinorUnits <= highest);

  return (
    foldMap(maybe(chain), ({ period, marks: chainMarks }) => ({ period, marks: chainMarks })) ??
    null
  );
};
