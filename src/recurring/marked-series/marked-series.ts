import {
  type Charge,
  type ChargeGroups,
  type RecurringMark,
  type RecurringPeriod,
  type RecurringSeries,
  foldTwins,
  groupKeyOf,
  onePerSlotOf,
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

type PieceChain = MarkedPiece & { charges: Charge[]; droppedIds: string[] };

type Chain = PieceChain & { key: string; name: string; currency: Currency };

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

// The one builder of a currency's chains, for the series and for the form's row read, so both
// drop the same charges: the amount cut picks the piece, then one charge a period stays.
const chainsOfCharges = (
  groupCharges: readonly Charge[],
  marks: readonly RecurringMark[],
): PieceChain[] => {
  const charges = foldTwins(groupCharges);

  return piecesOf(
    charges.map(({ amount }) => amount),
    marks,
  ).map((piece) => {
    const { kept, dropped } = onePerSlotOf(
      charges.filter(({ amount }) => amount >= piece.lowest && amount <= piece.highest),
      piece.period,
      piece.marks.map(({ amountMinorUnits }) => amountMinorUnits),
    );

    return { ...piece, charges: kept, droppedIds: dropped.map(({ id }) => id) };
  });
};

const chainsOfEntry = (chargeGroups: ChargeGroups, { key, name, marks }: MarkedEntry): Chain[] => {
  const sorted = [...marks].sort(compareMarks);

  return [...new Set(sorted.map(({ currency }) => currency))].flatMap((currency) =>
    chainsOfCharges(
      chargeGroups.groups.get(groupKeyOf(key, currency))?.charges ?? [],
      sorted.filter((mark) => mark.currency === currency),
    ).map((chain) => ({ ...chain, key, name, currency })),
  );
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
 * only the group of its own key and currency, so no amount compares across currencies. A stored
 * amount alone in its piece selects nothing and comes back as a chain without charges. A chain
 * keeps charges more than half a period apart, near amounts first, so a second charge of the
 * same month stays out of the series. The output order does not depend on the order of the rows
 * or of the marks.
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
 * charges, unfolded: the one-per-period rule reads their times, so the fold is needed here too.
 * `holdsRow` is false for a row that rule drops; a folded twin and a row outside the read stay
 * held.
 */
export const markedChainOfAmount = (
  charges: readonly Charge[],
  marks: readonly RecurringMark[],
  row: { id: string; amountMinorUnits: number },
  currency: Currency,
): { period: RecurringPeriod; marks: readonly RecurringMark[]; holdsRow: boolean } | null => {
  const chain = chainsOfCharges(
    charges,
    marks.filter((mark) => mark.currency === currency).sort(compareMarks),
  ).find(
    ({ lowest, highest }) => row.amountMinorUnits >= lowest && row.amountMinorUnits <= highest,
  );

  return (
    foldMap(maybe(chain), ({ period, marks: chainMarks, droppedIds }) => ({
      period,
      marks: chainMarks,
      holdsRow: !droppedIds.includes(row.id),
    })) ?? null
  );
};
