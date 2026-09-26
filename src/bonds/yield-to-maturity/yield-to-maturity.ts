import maybe, { foldMap } from 'fnts/maybe';
import { startOfLocalDay } from '@kiko/dates';
import { daysBetween } from '@kiko/holdings/interest';

/** One cash flow a lot receives: an integer minor-units amount on a local day. */
export type CashFlow = {
  date: number;
  amountMinorUnits: number;
};

/** One purchase: the day, the total paid (null when unknown), and the flows it earns. */
type YieldLot = {
  date: number;
  paidMinorUnits: number | null;
  cashFlows: readonly CashFlow[];
};

const DAYS_PER_YEAR = 365;
// Bisection stops once the bracket in ln(1 + rate) is narrower than this —
// far below the 0.00005 a 2-decimal percent can show.
const SOLVER_TOLERANCE = 1e-12;
const SOLVER_MAX_ITERATIONS = 200;
const BRACKET_MAX_EXPANSIONS = 64;

type TimedFlow = { years: number; amountMinorUnits: number };

// Doubles each end outward until the value changes sign across the bracket;
// 64 doublings put either end past the point where `Math.exp` saturates, so a
// root is always bracketed for a positive price and positive flows.
const bracketRoot = (netPresentValue: (logRate: number) => number): [number, number] | null => {
  let low = -1;
  let high = 1;

  for (let expansion = 0; expansion < BRACKET_MAX_EXPANSIONS; expansion += 1) {
    if (netPresentValue(low) > 0 && netPresentValue(high) < 0) {
      return [low, high];
    }

    low *= 2;
    high *= 2;
  }

  return null;
};

const bisect = (
  netPresentValue: (logRate: number) => number,
  low: number,
  high: number,
): number => {
  let lower = low;
  let upper = high;

  for (
    let iteration = 0;
    iteration < SOLVER_MAX_ITERATIONS && upper - lower > SOLVER_TOLERANCE;
    iteration += 1
  ) {
    const middle = (lower + upper) / 2;

    if (netPresentValue(middle) > 0) {
      lower = middle;
    } else {
      upper = middle;
    }
  }

  return (lower + upper) / 2;
};

/**
 * The effective annual yield to maturity of one lot, as a decimal fraction
 * (0.154 for 15.4%): the rate at which the flows received strictly after the
 * lot's local day, discounted act/365, sum to the price paid. A flow on the
 * lot day itself was paid to the seller, not to this lot. Null for a lot
 * without a price or with nothing left to receive.
 *
 * Solved by bisection in ln(1 + rate), where the present value of positive
 * flows falls strictly as the rate rises over the whole real line — one root
 * always exists, and the solver is deterministic with a fixed tolerance and
 * iteration cap. Amounts stay integer minor units; only the discounting is
 * floating point.
 */
export const yieldToMaturity = (
  cashFlows: readonly CashFlow[],
  paidMinorUnits: number | null,
  lotDate: number,
): number | null => {
  if (paidMinorUnits === null || paidMinorUnits <= 0) {
    return null;
  }

  const lotDay = startOfLocalDay(lotDate);
  const timedFlows: TimedFlow[] = cashFlows
    .filter((flow) => startOfLocalDay(flow.date) > lotDay && flow.amountMinorUnits > 0)
    .map((flow) => ({
      years: daysBetween(lotDate, flow.date) / DAYS_PER_YEAR,
      amountMinorUnits: flow.amountMinorUnits,
    }));

  if (timedFlows.length === 0) {
    return null;
  }

  const netPresentValue = (logRate: number): number =>
    timedFlows.reduce(
      (sum, flow) => sum + flow.amountMinorUnits * Math.exp(-logRate * flow.years),
      0,
    ) - paidMinorUnits;
  const bracket = bracketRoot(netPresentValue);

  if (bracket === null) {
    return null;
  }

  return Math.expm1(bisect(netPresentValue, bracket[0], bracket[1]));
};

/**
 * The yield of several lots together: each priced lot's own yield, weighted
 * by the amount paid for it. A lot without a price has no yield and no
 * weight; null when no lot has one.
 */
export const portfolioYieldToMaturity = (lots: readonly YieldLot[]): number | null => {
  const pricedLots = lots.flatMap(
    (lot) =>
      foldMap(maybe(yieldToMaturity(lot.cashFlows, lot.paidMinorUnits, lot.date)), (lotYield) => [
        { lotYield, weight: lot.paidMinorUnits ?? 0 },
      ]) ?? [],
  );
  const totalWeight = pricedLots.reduce((sum, lot) => sum + lot.weight, 0);

  if (totalWeight === 0) {
    return null;
  }

  return pricedLots.reduce((sum, lot) => sum + lot.lotYield * lot.weight, 0) / totalWeight;
};
