import { DAY_MS } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import type { FundingMatchRow } from '@kiko/db';
import type { BinancePendingRange } from '@kiko/crypto-sync/exchange/walk-state';
import { addDecimal, compareDecimal, normalizeDecimal, trimDecimal } from '@kiko/currency/decimal';

/** How far apart a ledger row and its source can be: no page states a delay, so one constant. */
export const FUNDING_MATCH_WINDOW_MS = 7 * DAY_MS;

/** How long after a row's time a source series may still show its source. */
export const FUNDING_MATCH_HOLD_MS = DAY_MS;

export type FundingVerdict = 'explained' | 'earnMove' | 'waiting' | 'held' | 'listed';

/**
 * What the shipped copy says about Earn money: `read` is an Earn balance with its own holding,
 * `inBalance` is Earn money already inside the Funding balance, and `notCounted` is Earn money
 * outside the total.
 */
export type FundingEarnClause = 'read' | 'inBalance' | 'notCounted';

/** A walk's cursor and the ground it still owes: the two marks rule 51 reads. */
export type FundingWalkMarks = { cursor: number | null; pending: readonly BinancePendingRange[] };

export type FundingMatchInput = {
  /** Every stored ledger row and source of the account, in any order. */
  rows: readonly FundingMatchRow[];
  marks: { capital: FundingWalkMarks; transfer: FundingWalkMarks; convert: FundingWalkMarks };
  earnClause: FundingEarnClause;
  /** The run's clock: the function reads none. */
  now: number;
  windowMs: number;
  holdMs: number;
};

const FUNDING_SERIES = ['deposit', 'internal', 'withdraw', 'transfer', 'convert'] as const;

type FundingSeries = (typeof FUNDING_SERIES)[number];

const WALK_OF_SERIES = {
  deposit: 'capital',
  internal: 'capital',
  withdraw: 'capital',
  transfer: 'transfer',
  convert: 'convert',
} as const satisfies Record<FundingSeries, keyof FundingMatchInput['marks']>;

const SERIES_OF_DIRECTION = new Map<string, readonly FundingSeries[]>([
  ['I', ['deposit', 'internal', 'transfer', 'convert']],
  ['O', ['withdraw', 'transfer', 'convert']],
]);

const EARN_MOVE_CLAUSES: readonly FundingEarnClause[] = ['read', 'inBalance'];

const isFundingSeries = (series: string | null): series is FundingSeries =>
  FUNDING_SERIES.some((name) => name === series);

const compareText = (first: string, second: string): number => {
  if (first < second) {
    return -1;
  }

  return first > second ? 1 : 0;
};

const byRecordKey = (first: FundingMatchRow, second: FundingMatchRow): number =>
  compareText(first.recordKey, second.recordKey);

const LEADING_ZEROS = /^0+(?=\d)/;

/**
 * The text two equal amounts share, so a lookup finds a candidate and no compare runs per pair:
 * `100`, `100.00` and `0100` are one key. A string edit, never a float.
 */
const amountKeyOf = (text: string): string | undefined =>
  foldMap(maybe(normalizeDecimal(text)), (plain) => trimDecimal(plain).replace(LEADING_ZEROS, ''));

const decimalOf = (text: string | null): string | undefined =>
  foldMap(maybe(text), (value) => normalizeDecimal(value) ?? undefined);

type AmountParts = {
  amount: string;
  minusFee: string | undefined;
  withFee: string | undefined;
  withTax: string | undefined;
};

/** The amounts a ledger row can show for one source, in the order each form is tried. */
const FORMS_OF_SERIES: Record<FundingSeries, (parts: AmountParts) => (string | undefined)[]> = {
  deposit: ({ amount, minusFee, withFee }) => [amount, minusFee, withFee],
  internal: ({ amount }) => [amount],
  withdraw: ({ amount, withFee, withTax }) => [amount, withFee, withTax],
  transfer: ({ amount }) => [amount],
  convert: ({ amount }) => [amount],
};

const partsOf = (source: FundingMatchRow): AmountParts | undefined =>
  foldMap(maybe(decimalOf(source.amount)), (amount) => {
    const fee = decimalOf(source.fee);
    const withFee = foldMap(maybe(fee), (value) => addDecimal(amount, value));

    return {
      amount,
      minusFee: foldMap(maybe(fee), (value) => addDecimal(amount, `-${value}`)),
      withFee,
      withTax: foldMap(maybe(withFee), (total) =>
        foldMap(maybe(decimalOf(source.tax)), (tax) => addDecimal(total, tax)),
      ),
    };
  });

const positiveKeyOf = (amount: string | undefined): string | undefined =>
  foldMap(maybe(amount), (text) => {
    return compareDecimal(text, '0') === 1 ? amountKeyOf(text) : undefined;
  });

/** The keys of the amounts a source can match, the first form winning when two forms agree. */
const formKeysOf = (source: FundingMatchRow, series: FundingSeries): string[] => {
  const keys = foldMap(maybe(partsOf(source)), (parts) =>
    FORMS_OF_SERIES[series](parts).map(positiveKeyOf),
  );

  return [...new Set((keys ?? []).filter((key): key is string => key !== undefined))];
};

const lookupKeyOf = (coin: string, direction: string, amountKey: string): string =>
  `${coin}|${direction}|${amountKey}`;

type Candidate = { source: number; form: number };

type Edge = { ledger: number; source: number; form: number; distance: number };

/** Zero inside an extent, and otherwise the gap to its nearer end. */
const gapBetween = (time: number, start: number, end: number): number =>
  Math.max(start - time, time - end, 0);

const candidateIndexOf = (sources: readonly FundingMatchRow[]): Map<string, Candidate[]> => {
  const index = new Map<string, Candidate[]>();

  for (const [sourceIndex, source] of sources.entries()) {
    const { series } = source;

    if (!isFundingSeries(series)) {
      continue;
    }

    for (const [form, amountKey] of formKeysOf(source, series).entries()) {
      const key = lookupKeyOf(source.coin, source.direction, amountKey);

      index.set(key, [...(index.get(key) ?? []), { source: sourceIndex, form }]);
    }
  }

  return index;
};

const edgesOf = (
  ledgers: readonly FundingMatchRow[],
  sources: readonly FundingMatchRow[],
  windowMs: number,
): Edge[] => {
  const index = candidateIndexOf(sources);

  return ledgers.flatMap(
    (ledger, ledgerIndex) =>
      foldMap(maybe(amountKeyOf(ledger.amount)), (amountKey) =>
        (index.get(lookupKeyOf(ledger.coin, ledger.direction, amountKey)) ?? []).flatMap(
          ({ source, form }) => {
            const extent = sources[source] as FundingMatchRow;
            const distance = gapBetween(ledger.timeStart, extent.timeStart, extent.timeEnd);

            return distance <= windowMs ? [{ ledger: ledgerIndex, source, form, distance }] : [];
          },
        ),
      ) ?? [],
  );
};

/** Form first, then distance, then the keys: ledgers and sources are indexed in key order. */
const byNearest = (first: Edge, second: Edge): number =>
  first.form - second.form ||
  first.distance - second.distance ||
  first.ledger - second.ledger ||
  first.source - second.source;

type Pairing = {
  sourceOfLedger: (number | undefined)[];
  ledgerOfSource: (number | undefined)[];
};

const assign = (pairing: Pairing, ledger: number, source: number): void => {
  pairing.sourceOfLedger[ledger] = source;
  pairing.ledgerOfSource[source] = ledger;
};

const pairNearestFirst = (edges: readonly Edge[], pairing: Pairing): void => {
  for (const { ledger, source } of edges) {
    if (
      pairing.sourceOfLedger[ledger] === undefined &&
      pairing.ledgerOfSource[source] === undefined
    ) {
      assign(pairing, ledger, source);
    }
  }
};

type Frame = { ledger: number; position: number };

/**
 * Looks for a free source for one ledger row through the pairs: it takes a candidate's source if
 * that is free, or asks the row that holds a candidate's source to move to another candidate,
 * down a chain as long as it needs. The stack is explicit, a pair is only moved and never
 * dropped, and no source is asked twice in one search.
 */
const repair = (
  start: number,
  candidates: readonly (readonly number[])[],
  pairing: Pairing,
): void => {
  const visited = new Set<number>();
  const frames: Frame[] = [];
  const claims: number[] = [];

  const enter = (ledger: number): number | undefined => {
    frames.push({ ledger, position: 0 });

    return (candidates[ledger] ?? []).find(
      (source) => pairing.ledgerOfSource[source] === undefined,
    );
  };

  let free = enter(start);

  while (free === undefined && frames.length > 0) {
    const frame = frames[frames.length - 1] as Frame;
    const source = (candidates[frame.ledger] ?? [])[frame.position];

    if (source === undefined) {
      frames.pop();
      claims.pop();
      continue;
    }

    frame.position += 1;

    const holder = pairing.ledgerOfSource[source];

    if (visited.has(source) || holder === undefined) {
      continue;
    }

    visited.add(source);
    claims.push(source);
    free = enter(holder);
  }

  if (free === undefined) {
    return;
  }

  const taken = [...claims, free];

  for (const [depth, { ledger }] of frames.entries()) {
    assign(pairing, ledger, taken[depth] as number);
  }
};

const pairingOf = (
  ledgers: readonly FundingMatchRow[],
  edges: readonly Edge[],
  sourceCount: number,
): Pairing => {
  const sorted = [...edges].sort(byNearest);
  const pairing: Pairing = {
    sourceOfLedger: new Array<number | undefined>(ledgers.length).fill(undefined),
    ledgerOfSource: new Array<number | undefined>(sourceCount).fill(undefined),
  };
  const candidates: number[][] = ledgers.map(() => []);

  for (const { ledger, source } of sorted) {
    candidates[ledger]?.push(source);
  }

  pairNearestFirst(sorted, pairing);

  const unpaired = ledgers
    .map((ledger, index) => ({ index, time: ledger.timeStart }))
    .filter(({ index }) => pairing.sourceOfLedger[index] === undefined)
    .filter(({ index }) => (candidates[index] ?? []).length > 0)
    .sort((first, second) => first.time - second.time || first.index - second.index);

  for (const { index } of unpaired) {
    repair(index, candidates, pairing);
  }

  return pairing;
};

type FreeSources = { starts: number[]; furthestEnds: number[] };

const upperBound = (sorted: readonly number[], value: number): number => {
  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if ((sorted[middle] as number) <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

const groupKeyOf = (coin: string, direction: string): string => `${coin}|${direction}`;

const freeSourceGroupOf = (members: readonly FundingMatchRow[]): FreeSources => {
  const furthestEnds: number[] = [];

  for (const member of members) {
    const previous = furthestEnds[furthestEnds.length - 1] ?? member.timeEnd;

    furthestEnds.push(Math.max(member.timeEnd, previous));
  }

  return { starts: members.map((member) => member.timeStart), furthestEnds };
};

/**
 * The sources no row took, by coin and direction, ordered by start. With the furthest end of each
 * prefix, whether any of them lies within a window of a time is one search: those that start in
 * time reach it if the furthest end of them does.
 */
const freeSourcesOf = (
  sources: readonly FundingMatchRow[],
  pairing: Pairing,
): Map<string, FreeSources> => {
  const free = sources
    .filter(
      (source, index) =>
        isFundingSeries(source.series) && pairing.ledgerOfSource[index] === undefined,
    )
    .sort((first, second) => first.timeStart - second.timeStart);
  const groups = new Map<string, FundingMatchRow[]>();

  for (const source of free) {
    const key = groupKeyOf(source.coin, source.direction);

    groups.set(key, [...(groups.get(key) ?? []), source]);
  }

  return new Map([...groups].map(([key, members]) => [key, freeSourceGroupOf(members)]));
};

const hasFreeSourceWithin = (
  free: Map<string, FreeSources>,
  row: FundingMatchRow,
  windowMs: number,
): boolean => {
  const group = free.get(groupKeyOf(row.coin, row.direction));

  if (group === undefined) {
    return false;
  }

  const reached = upperBound(group.starts, row.timeStart + windowMs);

  return (group.furthestEnds[reached - 1] ?? Number.NEGATIVE_INFINITY) >= row.timeStart - windowMs;
};

const isBehind = (marks: FundingWalkMarks, time: number, holdMs: number): boolean =>
  marks.cursor === null || time + holdMs > marks.cursor;

const owesNear = (
  marks: FundingWalkMarks,
  series: FundingSeries,
  time: number,
  windowMs: number,
): boolean =>
  marks.pending.some(
    (ground) =>
      (ground.series === undefined || ground.series === series) &&
      gapBetween(time, ground.start, ground.end) <= windowMs,
  );

/**
 * Whether one source series may not have shown the source of a row yet: its cursor is not a hold
 * past the row, or it owes ground within a window of it. The convert walk holds only a row under
 * a window old, so a route that is refused for good never holds a row for good.
 */
const seriesHolds = (series: FundingSeries, time: number, input: FundingMatchInput): boolean => {
  const marks = input.marks[WALK_OF_SERIES[series]];

  if (series === 'convert' && input.now - time >= input.windowMs) {
    return false;
  }

  return isBehind(marks, time, input.holdMs) || owesNear(marks, series, time, input.windowMs);
};

const isWaiting = (row: FundingMatchRow, input: FundingMatchInput): boolean =>
  (SERIES_OF_DIRECTION.get(row.direction) ?? []).some((series) =>
    seriesHolds(series, row.timeStart, input),
  );

/**
 * Rule 51 on the whole stored set: one verdict per ledger row, by its key. A pure function of its
 * input: the same rows give the same verdicts in any order, and it reads no clock, no database and
 * no float.
 */
export const matchFundingLedger = (input: FundingMatchInput): Map<string, FundingVerdict> => {
  const ledgers = input.rows.filter((row) => row.side === 'ledger').sort(byRecordKey);
  const sources = input.rows.filter((row) => row.side === 'source').sort(byRecordKey);
  const pairing = pairingOf(ledgers, edgesOf(ledgers, sources, input.windowMs), sources.length);
  const free = freeSourcesOf(sources, pairing);
  const earnIsCounted = EARN_MOVE_CLAUSES.includes(input.earnClause);

  const verdictOf = (row: FundingMatchRow, index: number): FundingVerdict => {
    if (pairing.sourceOfLedger[index] !== undefined) {
      return 'explained';
    }

    if (row.earnPrincipal && earnIsCounted) {
      return 'earnMove';
    }

    if (isWaiting(row, input)) {
      return 'waiting';
    }

    return hasFreeSourceWithin(free, row, input.windowMs) ? 'held' : 'listed';
  };

  return new Map(ledgers.map((row, index) => [row.recordKey, verdictOf(row, index)]));
};
