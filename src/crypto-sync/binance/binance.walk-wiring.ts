import { match } from 'ts-pattern';
import {
  type CommitDeps,
  commitExchangeSpan,
  type OwedWindow,
  placeWalletRows,
  runExchangeWalkPlan,
  type SettledSpan,
  type SpanCommit,
  type SpanRead,
  type WalkMarkWriter,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import type { ExchangeHolding } from '@kiko/holdings/repo';

import { isBinanceCoolingDown } from './binance.cooldown';
import { partsOfHoldingKey } from './binance.holding-keys';
import { BINANCE_ASSET, type FetchAccountOptions } from './binance.client';
import { BINANCE_WALK_CONFIG, isUnreadableWindowError } from './binance.walk-config';
import type { BinanceHistoryRun, BudgetLane, CallCost } from './binance.history-budget';

/** What every Binance history walk holds for one run, over the deps and the extras of its own. */
export type BinanceWalkContext<Deps> = {
  deps: Deps;
  run: BinanceHistoryRun;
  accountId: string;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
};

type SpanCommitContext<Row> = Pick<
  BinanceWalkContext<CommitDeps<Row>>,
  'deps' | 'accountId' | 'marks' | 'plan' | 'write'
>;

type WalletPlacerContext = {
  deps: {
    listHoldings: (accountId: string) => Promise<HoldingRow[]>;
    ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  };
  accountId: string;
};

type WalletPlanned = Parameters<typeof placeWalletRows>[0]['planned'][number];

/**
 * The place step of a walk whose rows sit on wallet holdings, which `missingCode` stops when a
 * wallet cannot be resolved.
 */
export const walletPlacerOf =
  (context: WalletPlacerContext, missingCode: string) =>
  <Planned extends WalletPlanned>(planned: Planned[]) =>
    placeWalletRows({
      accountId: context.accountId,
      planned,
      config: BINANCE_WALK_CONFIG,
      listHoldings: context.deps.listHoldings,
      ensureHoldings: context.deps.ensureHoldings,
      missingCode,
    });

/**
 * The rows a window of `scope` writes. The backfill reads the coins a walk did not read before its
 * first multi-coin run, so it leaves BTC out: those rows are already stored, and one the user
 * deleted must not come back. The other coins of the same record are written.
 */
const rowsOfScope = <Planned extends { wallet: string }>(
  planned: Planned[],
  scope: OwedWindow['scope'],
): Planned[] =>
  match(scope)
    .returnType<Planned[]>()
    .with(undefined, () => planned)
    .with('backfill', () =>
      planned.filter((row) => partsOfHoldingKey(row.wallet)?.code !== BINANCE_ASSET),
    )
    .exhaustive();

/**
 * Commit one span of a Binance walk (see `commitExchangeSpan`). A window of the backfill scope
 * writes the rows of every coin but BTC.
 */
export const commitBinanceSpan = <Planned extends { wallet: string }, Row>(input: {
  context: SpanCommitContext<Row>;
  pass: WalkPass;
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
  restartMs: number;
  series?: OwedWindow['series'];
  scope?: OwedWindow['scope'];
  forwardOwes?: readonly string[];
}): Promise<SpanCommit | undefined> =>
  commitExchangeSpan({
    ...input,
    place: (planned) => input.place(rowsOfScope(planned, input.scope)),
  });

/**
 * Run a Binance walk's plan: each window is read span by span and committed, on the lane's budget
 * and while the account is not cooling down (see `runExchangeWalkPlan`).
 */
export const runBinanceWalkPlan = <Page>(input: {
  context: Pick<
    BinanceWalkContext<{ now: () => number }>,
    'deps' | 'run' | 'accountId' | 'marks' | 'plan' | 'write'
  >;
  lane: BudgetLane;
  cost: CallCost;
  read: (window: OwedWindow, span: WalkWindow, keep: number) => Promise<SpanRead<Page> | undefined>;
  commit: (
    window: OwedWindow,
    span: WalkWindow,
    page: Page,
    pass: WalkPass,
  ) => Promise<SpanCommit | undefined>;
  callsOf?: (window: OwedWindow) => number;
  owedFirst?: boolean;
  readOnPastUnreadableForward?: boolean;
}): Promise<WalkResult> =>
  runExchangeWalkPlan({
    ...input,
    isCoolingDown: isBinanceCoolingDown,
    isUnreadableWindowError,
  });

/**
 * A plan holds a capped number of windows, so a forward pass that ends before `endTime` has more
 * history behind it than the windows it read.
 */
export const completeIfPlanReached = (
  result: WalkResult,
  plan: WalkPlan,
  endTime: number,
): WalkResult => {
  const lastWindowEnd = plan.forward.at(-1)?.end;

  return {
    ...result,
    complete: result.complete && (lastWindowEnd === undefined || lastWindowEnd >= endTime),
  };
};
