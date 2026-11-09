import { DAY_MS } from '@kiko/dates';
import type { FundingMatchRow } from '@kiko/db';

import {
  FUNDING_MATCH_HOLD_MS,
  FUNDING_MATCH_WINDOW_MS,
  type FundingMatchInput,
  type FundingVerdict,
  type FundingWalkMarks,
  matchFundingLedger,
} from './bybit.funding-match';

export const NOW = 400 * DAY_MS;

const ORIGIN = NOW - 100 * DAY_MS;

/** A moment `days` after the origin, which sits a hundred days before `NOW`. */
export const atDay = (days: number): number => ORIGIN + days * DAY_MS;

type SourceSeries = 'deposit' | 'internal' | 'withdraw' | 'transfer' | 'convert';

const OUT_SERIES: readonly SourceSeries[] = ['withdraw'];

type RecordOverrides = Partial<
  Pick<FundingMatchRow, 'coin' | 'direction' | 'amount' | 'fee' | 'tax' | 'earnPrincipal'>
> & { until?: number };

/** A stored ledger row at `time`, In unless the overrides say Out. */
export const ledgerRowOf = (
  recordKey: string,
  time: number,
  overrides: RecordOverrides = {},
): FundingMatchRow => ({
  accountId: 'acc-1',
  side: 'ledger',
  recordKey,
  series: null,
  coin: 'USDT',
  direction: 'I',
  amount: '100',
  fee: null,
  tax: null,
  timeStart: time,
  timeEnd: time,
  earnPrincipal: false,
  ...overrides,
});

/** A stored source of `series`, its direction the one that series moves unless overridden. */
export const sourceRowOf = (
  recordKey: string,
  series: SourceSeries,
  time: number,
  overrides: RecordOverrides = {},
): FundingMatchRow => {
  const { until, ...columns } = overrides;

  return {
    ...ledgerRowOf(recordKey, time, { direction: OUT_SERIES.includes(series) ? 'O' : 'I' }),
    side: 'source',
    series,
    timeEnd: until ?? time,
    ...columns,
  };
};

const settledWalk = (): FundingWalkMarks => ({ cursor: NOW, pending: [] });

/** Every walk read to `NOW` and owing nothing. */
export const settledMarks = (): FundingMatchInput['marks'] => ({
  capital: settledWalk(),
  transfer: settledWalk(),
  convert: settledWalk(),
});

type InputOverrides = Partial<Omit<FundingMatchInput, 'rows'>>;

const inputOf = (
  rows: readonly FundingMatchRow[],
  overrides: InputOverrides,
): FundingMatchInput => ({
  rows,
  marks: settledMarks(),
  earnClause: 'notCounted',
  now: NOW,
  windowMs: FUNDING_MATCH_WINDOW_MS,
  holdMs: FUNDING_MATCH_HOLD_MS,
  ...overrides,
});

/** The verdict of each ledger row, by key, with every walk settled unless the overrides say not. */
export const verdictsOf = (
  rows: readonly FundingMatchRow[],
  overrides: InputOverrides = {},
): Record<string, FundingVerdict> =>
  Object.fromEntries(matchFundingLedger(inputOf(rows, overrides)));
