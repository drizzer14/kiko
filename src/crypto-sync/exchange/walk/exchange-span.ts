import {
  advanceWalkMarks,
  type OwedWindow,
  type SpanCommit,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkWindow,
} from './walk';
import {
  commitSettledSpan,
  historyListWriterOf,
  notImportedWriterOf,
  type SettledSpan,
} from './records';
import type { ExchangeStateDeps, WalkMarkWriter } from './exchange-state-deps';

type CommitDeps<Row> = Pick<ExchangeStateDeps, 'patchExchangeState'> & {
  addTransactions: (rows: Row[]) => Promise<number>;
};

type SpanCommitContext<Row> = {
  deps: CommitDeps<Row>;
  accountId: string;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
};

/**
 * Commit one span of an exchange walk: the rows first, the marks second (see `commitSettledSpan`).
 * `series` names the series a window was narrowed to and `scope` the scope it was read in; a walk
 * that never narrows a window leaves `series` out, so a span reads all of it, and a window read
 * for every coin has no scope. `place` is the walk's own: it turns the planned rows into the rows
 * to add, and what a scope leaves out of them is its decision, not this commit's.
 */
export const commitExchangeSpan = <Planned, Row>(input: {
  context: SpanCommitContext<Row>;
  pass: WalkPass;
  span: WalkWindow;
  settled: SettledSpan<Planned>;
  place: (planned: Planned[]) => Promise<Row[]>;
  restartMs: number;
  series?: OwedWindow['series'];
  scope?: OwedWindow['scope'];
  forwardOwes?: readonly string[];
}): Promise<SpanCommit | undefined> => {
  const { context, pass, span, series, scope, restartMs } = input;
  const { deps, accountId, plan, marks, write } = context;

  return commitSettledSpan({
    pass,
    span,
    settled: input.settled,
    forwardOwes: input.forwardOwes,
    place: input.place,
    add: deps.addTransactions,
    writeOversized: historyListWriterOf(deps, accountId, 'oversizedCoins'),
    writeUntracked: historyListWriterOf(deps, accountId, 'untrackedCoins'),
    writeNotImported: notImportedWriterOf(deps, accountId),
    advance: ({ owed }) =>
      advanceWalkMarks({
        pass,
        span,
        series,
        scope,
        owed,
        plan,
        marks,
        restartMs,
        write,
      }),
  });
};
