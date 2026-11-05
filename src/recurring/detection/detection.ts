import { match } from 'ts-pattern';
import {
  merchantNameOf,
  smallestSpelling,
  merchantSpellingOf,
} from '@kiko/transactions/merchant-name';
import maybe, { foldMap } from 'fnts/maybe';
import { maxOf, minOf } from '@kiko/numbers';
import { startOfLocalDay } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import { addMonths, daysBetween } from '@kiko/holdings/interest';
import { isRecurringCandidate, recurringExcludedIds } from '@kiko/recurring/eligibility';

import type {
  Charge,
  Recurrence,
  ChargeGroup,
  ChargeGroups,
  DetectedPeriod,
  RecurringInput,
  RecurringPeriod,
  RecurringSeries,
  RecurringLedgerRow,
} from './detection.types.d';

type PeriodRule = {
  period: DetectedPeriod;
  minimumCharges: number;
  // Local days a charge may sit from its expected date.
  tolerance: number;
  maximumSlots: number;
  amountStep: number;
  // Only guesses the nearest whole number of periods; the deviation decides.
  slotDays: number;
  allowedJumps: (charges: number) => number;
  stepForward: (time: number, slots: number) => number;
  recurrenceOf: (newestFirst: readonly Charge[]) => Recurrence;
};

// What a series is built from: its charges oldest first, the period it reads under and its date
// line.
type SeriesParts = { charges: readonly Charge[]; period: RecurringPeriod; recurrence: Recurrence };

type Found = { charges: Charge[]; rule: PeriodRule };

type SlotPair = { slots: number; deviation: number };

type PassOptions = { withAmounts: boolean; minimumCharges?: number };

type KeptCharge = { charge: Charge; absorbed: Set<Charge['source']> };

type DatedRow = { row: RecurringLedgerRow; time: number };

const AMOUNT_STEP = 1.25;
const WEEKLY_AMOUNT_STEP = 1.1;
const MIN_FIT_SHARE = 0.75;
const MIN_OCCUPANCY = 0.75;
const MIN_COVERAGE = 0.5;
const ONE_A_SLOT_MIN_CHARGES = 6;
const DAY_SPLIT_GAP = 3;
const TWIN_DAY_REACH = 1;
const LEAVES_AFTER_MONTHS = 24;
const AROUND_DAY_SPREAD = 6;
const CHARGES_PER_EXTRA_JUMP = 24;
const WEEK_DAYS = 7;
const MONTHS_PER_YEAR = 12;
// The month's last day and the next month's first are one day apart in a 31-day month.
const DAYS_IN_LONGEST_MONTH = 31;
const AVERAGE_MONTH_DAYS = 30.4375;
const AVERAGE_YEAR_DAYS = 365.25;
const MONTHLY_RECURRENCE_SAMPLE = 3;
const WEEKLY_RECURRENCE_SAMPLE = 4;
const WEEKDAY_SHARE = 3;

const NO_RECURRENCE: Recurrence = { kind: 'none' };
const MARKED_RECURRENCE: Recurrence = { kind: 'marked' };

const SOURCE_RANK: Record<RecurringLedgerRow['source'], number> = {
  monobank: 0,
  btc_wallet: 0,
  binance: 0,
  manual: 1,
  import: 2,
};

const total = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

// Compares by code unit, never by locale, so no order depends on the device.
export const compareText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

const compareCharges = (left: Charge, right: Charge): number =>
  left.time - right.time || compareText(left.id, right.id);

const groupedBy = <Item, Key>(items: readonly Item[], keyOf: (item: Item) => Key) => {
  const groups = new Map<Key, Item[]>();

  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }

  return groups;
};

const localDayOfMonthOf = (time: number): number => new Date(time).getDate();

const isLastDayOfMonth = (time: number): boolean => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getDate() === 1;
};

const monthlyRecurrenceOf = (newestFirst: readonly Charge[]): Recurrence => {
  const sample = newestFirst.slice(0, MONTHLY_RECURRENCE_SAMPLE);
  const days = sample.map(({ time }) => localDayOfMonthOf(time));
  const sharedDay = days.find((day, index) => days.indexOf(day) !== index);

  if (sample.every(({ time }) => isLastDayOfMonth(time))) {
    return { kind: 'lastDay' };
  }

  if (sharedDay !== undefined) {
    return { kind: 'onDay', day: sharedDay };
  }

  if (maxOf(days) - minOf(days) > AROUND_DAY_SPREAD) {
    return NO_RECURRENCE;
  }

  const middleDay = [...days].sort((left, right) => left - right)[Math.floor(days.length / 2)];

  return foldMap(maybe(middleDay), (day) => ({ kind: 'aroundDay' as const, day })) ?? NO_RECURRENCE;
};

const weeklyRecurrenceOf = (newestFirst: readonly Charge[]): Recurrence => {
  const weekdays = newestFirst
    .slice(0, WEEKLY_RECURRENCE_SAMPLE)
    .map(({ time }) => new Date(time).getDay());
  const sharedWeekday = weekdays.find(
    (weekday) => weekdays.filter((other) => other === weekday).length >= WEEKDAY_SHARE,
  );

  return (
    foldMap(maybe(sharedWeekday), (weekday) => ({ kind: 'onWeekday' as const, weekday })) ??
    NO_RECURRENCE
  );
};

const yearlyRecurrenceOf = (newestFirst: readonly Charge[]): Recurrence =>
  foldMap(maybe(newestFirst[0]), ({ time }) => ({ kind: 'onDate' as const, time })) ??
  NO_RECURRENCE;

const weekStepOf = (time: number, weeks: number): number => {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + WEEK_DAYS * weeks,
  ).getTime();
};

const MONTHLY: PeriodRule = {
  period: 'monthly',
  minimumCharges: 3,
  tolerance: 4,
  maximumSlots: 3,
  amountStep: AMOUNT_STEP,
  slotDays: AVERAGE_MONTH_DAYS,
  allowedJumps: (charges) => 1 + Math.floor(charges / CHARGES_PER_EXTRA_JUMP),
  stepForward: addMonths,
  recurrenceOf: monthlyRecurrenceOf,
};

const YEARLY: PeriodRule = {
  period: 'yearly',
  minimumCharges: 2,
  tolerance: 5,
  maximumSlots: 1,
  amountStep: AMOUNT_STEP,
  slotDays: AVERAGE_YEAR_DAYS,
  allowedJumps: () => 0,
  stepForward: (time, years) => addMonths(time, MONTHS_PER_YEAR * years),
  recurrenceOf: yearlyRecurrenceOf,
};

const WEEKLY: PeriodRule = {
  period: 'weekly',
  minimumCharges: 5,
  tolerance: 1,
  maximumSlots: 3,
  amountStep: WEEKLY_AMOUNT_STEP,
  slotDays: WEEK_DAYS,
  allowedJumps: () => 0,
  stepForward: weekStepOf,
  recurrenceOf: weeklyRecurrenceOf,
};

const PERIOD_RULES: readonly PeriodRule[] = [WEEKLY, MONTHLY, YEARLY];

/** The picker's order, which also settles a tie between two marks of one amount. */
export const RECURRING_PERIODS: readonly RecurringPeriod[] = [
  'weekly',
  'monthly',
  'everyThreeMonths',
  'everySixMonths',
  'yearly',
];

// How long after its last charge a series reads as stopped, grace included.
const STOPPED_AFTER: Record<RecurringPeriod, { months: number; days: number }> = {
  // Two weeks and 3 days of grace.
  weekly: { months: 0, days: 2 * WEEK_DAYS + 3 },
  monthly: { months: 1, days: 7 },
  everyThreeMonths: { months: 3, days: 14 },
  everySixMonths: { months: 6, days: 14 },
  yearly: { months: MONTHS_PER_YEAR, days: 14 },
};

// Steps back with local calendar fields: a local day is not always 24 hours.
const stoppedCutoffOf = (period: RecurringPeriod, today: number): number => {
  const { months, days } = STOPPED_AFTER[period];
  const monthsBack = new Date(addMonths(today, -months));

  return new Date(
    monthsBack.getFullYear(),
    monthsBack.getMonth(),
    monthsBack.getDate() - days,
  ).getTime();
};

// `daysBetween` clamps at zero, so a deviation is the larger of both orders.
const dayGapOf = (left: number, right: number): number =>
  Math.max(daysBetween(left, right), daysBetween(right, left));

const slotPairOf = (earlier: Charge, later: Charge, rule: PeriodRule): SlotPair => {
  const nearest = Math.round(daysBetween(earlier.time, later.time) / rule.slotDays);
  const candidates = [nearest - 1, nearest, nearest + 1]
    .filter((slots) => slots >= 0)
    .map((slots) => ({
      slots,
      deviation: dayGapOf(rule.stepForward(earlier.time, slots), later.time),
    }));

  // A tie keeps the fewer slots, so two charges halfway apart share a slot.
  return candidates.reduce((best, candidate) =>
    candidate.deviation < best.deviation ? candidate : best,
  );
};

const slotPairsOf = (charges: readonly Charge[], rule: PeriodRule): SlotPair[] =>
  charges.slice(1).map((later, index) => slotPairOf(charges[index], later, rule));

const isFit = (pair: SlotPair, rule: PeriodRule): boolean =>
  pair.slots >= 1 && pair.slots <= rule.maximumSlots && pair.deviation <= rule.tolerance;

const jumpsOf = (charges: readonly Charge[], step: number): number =>
  charges.slice(1).filter((later, index) => {
    const earlier = charges[index];

    return Math.max(earlier.amount, later.amount) > Math.min(earlier.amount, later.amount) * step;
  }).length;

const passes = (
  charges: readonly Charge[],
  rule: PeriodRule,
  { withAmounts, minimumCharges = rule.minimumCharges }: PassOptions,
): boolean => {
  if (charges.length < minimumCharges) {
    return false;
  }

  const pairs = slotPairsOf(charges, rule);
  const fits = pairs.filter((pair) => isFit(pair, rule)).length;
  const slotTotal = total(pairs.map(({ slots }) => slots));

  return (
    fits / pairs.length >= MIN_FIT_SHARE &&
    charges.length / (1 + slotTotal) >= MIN_OCCUPANCY &&
    (!withAmounts || jumpsOf(charges, rule.amountStep) <= rule.allowedJumps(charges.length))
  );
};

const hasSharedSlot = (charges: readonly Charge[]): boolean =>
  slotPairsOf(charges, MONTHLY).some(({ slots }) => slots === 0);

const periodOf = (charges: readonly Charge[]): PeriodRule | undefined =>
  PERIOD_RULES.find((rule) => passes(charges, rule, { withAmounts: true }));

const foundIn = (charges: Charge[]): Found[] =>
  foldMap(maybe(periodOf(charges)), (rule) => [{ charges, rule }]) ?? [];

const monthlyFound = (charges: Charge[]): Found[] => [{ charges, rule: MONTHLY }];

/**
 * The amounts sorted and cut where the next exceeds the previous by more than the step. The
 * pieces ascend and no amount sits in two of them, so a piece's lowest and highest amounts tell
 * which charges it holds.
 */
export const amountPiecesOf = (amounts: readonly number[]): number[][] => {
  const pieces: number[][] = [];

  for (const amount of [...amounts].sort((left, right) => left - right)) {
    const piece = pieces.at(-1);

    if (piece !== undefined && amount <= piece[piece.length - 1] * AMOUNT_STEP) {
      piece.push(amount);
    } else {
      pieces.push([amount]);
    }
  }

  return pieces;
};

// The charges of each piece of `amountPiecesOf`, in the time order they arrive in. Placing them by
// amount, not sorting them again, keeps this to the one sort inside the cut.
const chargePiecesOf = (charges: readonly Charge[]): Charge[][] => {
  const pieces = amountPiecesOf(charges.map(({ amount }) => amount));
  const pieceIndexByAmount = new Map(
    pieces.flatMap((piece, index) => piece.map((amount) => [amount, index] as const)),
  );
  const chargePieces: Charge[][] = pieces.map(() => []);

  for (const charge of charges) {
    chargePieces[pieceIndexByAmount.get(charge.amount) ?? 0].push(charge);
  }

  return chargePieces;
};

const monthIndexOf = (time: number): number => {
  const date = new Date(time);

  return date.getFullYear() * MONTHS_PER_YEAR + date.getMonth();
};

const hasTwoInOneMonth = (charges: readonly Charge[]): boolean =>
  new Set(charges.map(({ time }) => monthIndexOf(time))).size < charges.length;

const rotated = <Item>(items: readonly Item[], start: number): Item[] => [
  ...items.slice(start),
  ...items.slice(0, start),
];

// Parts by day of the month, cut at a gap over `DAY_SPLIT_GAP`; the month's end wraps to its
// start, so the 31st and the 1st sit one day apart.
const dayPartsOf = (charges: readonly Charge[]): Charge[][] => {
  const ordered = [...charges].sort(
    (left, right) =>
      localDayOfMonthOf(left.time) - localDayOfMonthOf(right.time) || compareCharges(left, right),
  );
  const days = ordered.map(({ time }) => localDayOfMonthOf(time));
  const isCutAfter = days.map(
    (day, index) =>
      (days[(index + 1) % days.length] - day + DAYS_IN_LONGEST_MONTH) % DAYS_IN_LONGEST_MONTH >
      DAY_SPLIT_GAP,
  );
  const firstCut = isCutAfter.indexOf(true);

  if (firstCut === -1) {
    return [ordered];
  }

  const start = (firstCut + 1) % ordered.length;
  const cuts = rotated(isCutAfter, start);
  const parts: Charge[][] = [[]];

  for (const [index, charge] of rotated(ordered, start).entries()) {
    parts[parts.length - 1].push(charge);

    if (cuts[index]) {
      parts.push([]);
    }
  }

  return parts.filter((part) => part.length > 0).map((part) => part.sort(compareCharges));
};

// What remains splits by day of month only where a calendar month holds two of its charges: a
// once-a-month visitor on random days would otherwise be cut into a lucky part.
const dayPartsFoundIn = (charges: Charge[]): Found[] =>
  hasTwoInOneMonth(charges)
    ? dayPartsOf(charges).flatMap((part) =>
        passes(part, MONTHLY, { withAmounts: true }) ? monthlyFound(part) : [],
      )
    : [];

const rescuedFrom = (piece: Charge[]): Found[] => {
  const exact = [...groupedBy(piece, ({ amount }) => amount).values()].flatMap(foundIn);
  const taken = new Set(exact.flatMap(({ charges }) => charges));

  return [...exact, ...dayPartsFoundIn(piece.filter((charge) => !taken.has(charge)))];
};

const isSteadyMonthly = ({ charges, rule }: Found): boolean => {
  const amounts = charges.map(({ amount }) => amount);

  return (
    rule === MONTHLY &&
    charges.length >= ONE_A_SLOT_MIN_CHARGES &&
    !hasSharedSlot(charges) &&
    maxOf(amounts) <= minOf(amounts) * AMOUNT_STEP
  );
};

const firstFound = (
  steps: readonly ((charges: Charge[]) => Found[])[],
  charges: Charge[],
): Found[] => {
  for (const step of steps) {
    const found = step(charges);

    if (found.length > 0) {
      return found;
    }
  }

  return [];
};

const splitByAmount = (charges: Charge[]): Found[] => {
  const found = chargePiecesOf(charges).flatMap((piece) =>
    firstFound([foundIn, rescuedFrom], piece),
  );
  const covered = total(found.map((entry) => entry.charges.length));

  return covered / charges.length >= MIN_COVERAGE ? found : found.filter(isSteadyMonthly);
};

const withoutAmountTestIn = (charges: Charge[]): Found[] =>
  passes(charges, MONTHLY, { withAmounts: false, minimumCharges: ONE_A_SLOT_MIN_CHARGES })
    ? monthlyFound(charges)
    : [];

const oneChargeASlotIn = (charges: Charge[]): Found[] =>
  withoutAmountTestIn(charges).filter((found) => !hasSharedSlot(found.charges));

const GROUP_STEPS = [foundIn, oneChargeASlotIn, splitByAmount, withoutAmountTestIn] as const;

const sourceOrder = (left: Charge, right: Charge): number =>
  SOURCE_RANK[left.source] - SOURCE_RANK[right.source] ||
  compareText(left.source, right.source) ||
  compareCharges(left, right);

const partnerOf = (kept: readonly KeptCharge[], charge: Charge): KeptCharge | undefined => {
  const open = kept.filter(
    ({ charge: other, absorbed }) => other.source !== charge.source && !absorbed.has(charge.source),
  );

  return (
    open.find((other) => dayGapOf(other.charge.time, charge.time) === 0) ??
    open.find((other) => dayGapOf(other.charge.time, charge.time) <= TWIN_DAY_REACH)
  );
};

// One bucket holds one signed amount. A row folds into one kept row of another source, at most
// once per source, on the same local day first and then one day apart.
const foldedBucket = (bucket: readonly Charge[]): Charge[] => {
  const kept: KeptCharge[] = [];

  for (const charge of [...bucket].sort(sourceOrder)) {
    const partner = partnerOf(kept, charge);

    if (partner === undefined) {
      kept.push({ charge, absorbed: new Set() });
    } else {
      partner.absorbed.add(charge.source);
    }
  }

  return kept.map((entry) => entry.charge);
};

export const foldTwins = (charges: readonly Charge[]): Charge[] =>
  [...groupedBy(charges, ({ amount }) => amount).values()]
    .flatMap(foldedBucket)
    .sort(compareCharges);

const nameOf = (charges: readonly Charge[]): string =>
  smallestSpelling(
    [...new Set(charges.map(({ description }) => description))].map((description) =>
      merchantSpellingOf(description),
    ),
  );

// A marked series reads its date line from the table of its period only when its own charges fit
// that period; its amounts are not tested, the chain already chose them. A period with no table
// (every 3 and every 6 months), a charge list that does not fit, and a table with no honest day
// all read as the user's word alone.
export const markedRecurrenceOf = (
  period: RecurringPeriod,
  charges: readonly Charge[],
): Recurrence => {
  const rule = PERIOD_RULES.find((candidate) => candidate.period === period);

  if (rule === undefined || !passes(charges, rule, { withAmounts: false })) {
    return MARKED_RECURRENCE;
  }

  return match(rule.recurrenceOf([...charges].reverse()))
    .with({ kind: 'none' }, () => MARKED_RECURRENCE)
    .otherwise((recurrence) => recurrence);
};

export const seriesOfCharges = (
  { charges, period, recurrence }: SeriesParts,
  { key, currency }: Pick<ChargeGroup, 'key' | 'currency'>,
  { newestTimeByHoldingId }: ChargeGroups,
  today: number,
): RecurringSeries => {
  const newestFirst = [...charges].reverse();
  const latest = newestFirst[0];
  const cutoff = stoppedCutoffOf(period, today);
  const isStopped = startOfLocalDay(latest.time) < cutoff;
  const newestRowTime = newestTimeByHoldingId.get(latest.holdingId) ?? latest.time;
  const isQuiet = isStopped && startOfLocalDay(newestRowTime) < cutoff;

  return {
    id: charges[0].id,
    merchantKey: key,
    name: nameOf(charges),
    currency,
    period,
    recurrence,
    chargeIds: newestFirst.map(({ id }) => id),
    lastChargeTime: latest.time,
    lastChargeAmountMinorUnits: latest.amount,
    lastChargeHoldingId: latest.holdingId,
    isStopped,
    quiet: isQuiet ? { since: newestRowTime, holdingName: latest.holdingName } : null,
  };
};

const seriesOf = (
  { charges, rule }: Found,
  group: ChargeGroup,
  groups: ChargeGroups,
  today: number,
): RecurringSeries =>
  seriesOfCharges(
    { charges, period: rule.period, recurrence: rule.recurrenceOf([...charges].reverse()) },
    group,
    groups,
    today,
  );

export const byNewestCharge = (left: RecurringSeries, right: RecurringSeries): number =>
  right.lastChargeTime - left.lastChargeTime || compareText(left.id, right.id);

const hasLeft = ({ lastChargeTime }: RecurringSeries, today: number): boolean =>
  today > startOfLocalDay(addMonths(lastChargeTime, LEAVES_AFTER_MONTHS));

// A row on a later local day than today is neither a charge nor activity.
const datedRowsOf = (rows: readonly RecurringLedgerRow[], today: number): DatedRow[] =>
  rows.flatMap((row) => {
    const time = row.time;

    return startOfLocalDay(time) > today ? [] : [{ row, time }];
  });

const newestTimeByHoldingIdOf = (dated: readonly DatedRow[]): Map<string, number> =>
  dated.reduce(
    (newest, { row, time }) =>
      newest.set(row.holdingId, Math.max(time, newest.get(row.holdingId) ?? time)),
    new Map<string, number>(),
  );

// The same key reads a group from `ChargeGroups`, so a mark finds exactly the charges of its
// merchant and currency.
export const groupKeyOf = (key: string, currency: Currency): string =>
  JSON.stringify([key, currency]);

const groupedChargesOf = (
  input: RecurringInput,
  dated: readonly DatedRow[],
): Map<string, ChargeGroup> => {
  const excludedIds = recurringExcludedIds(input.rows, input.holdings, input.accounts);
  const holdingById = new Map(input.holdings.map((holding) => [holding.id, holding]));
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  const keyByDescription = new Map<string, string>();
  const groups = new Map<string, ChargeGroup>();

  for (const { row, time } of dated) {
    const holding = holdingById.get(row.holdingId);
    const account = foldMap(maybe(holding), ({ accountId }) => accountById.get(accountId));

    if (
      holding === undefined ||
      !isRecurringCandidate(row, holding, account) ||
      excludedIds.has(row.id)
    ) {
      continue;
    }

    const key = keyByDescription.get(row.description) ?? merchantNameOf(row.description).key;

    keyByDescription.set(row.description, key);

    if (key === '') {
      continue;
    }

    const groupKey = groupKeyOf(key, holding.currency);
    const group = groups.get(groupKey) ?? { key, currency: holding.currency, charges: [] };

    group.charges.push({
      id: row.id,
      time,
      amount: -row.amountMinorUnits,
      source: row.source,
      holdingId: row.holdingId,
      holdingName: holding.name,
      description: row.description,
    });
    groups.set(groupKey, group);
  }

  return groups;
};

/**
 * The charges of the whole ledger by merchant key and currency. `now` is read only through its
 * local day: a row on a later local day is neither a charge nor activity.
 */
export const chargeGroupsOf = (input: RecurringInput, now: number): ChargeGroups => {
  const dated = datedRowsOf(input.rows, startOfLocalDay(now));

  return {
    groups: groupedChargesOf(input, dated),
    newestTimeByHoldingId: newestTimeByHoldingIdOf(dated),
  };
};

/**
 * The charges that repeated, grouped by merchant key and currency. It states what the rows show:
 * no next date, no sum, and no output date on a later local day than `now`'s.
 */
export const seriesOfGroups = (chargeGroups: ChargeGroups, now: number): RecurringSeries[] => {
  const today = startOfLocalDay(now);

  return [...chargeGroups.groups.values()]
    .flatMap((group) =>
      firstFound(GROUP_STEPS, foldTwins(group.charges)).map((found) =>
        seriesOf(found, group, chargeGroups, today),
      ),
    )
    .filter((series) => !hasLeft(series, today))
    .sort(byNewestCharge);
};

export const detectRecurringSeries = (input: RecurringInput, now: number): RecurringSeries[] =>
  seriesOfGroups(chargeGroupsOf(input, now), now);
