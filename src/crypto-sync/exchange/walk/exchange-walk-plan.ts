import type { RunBudget } from '../budget';

import {
  dropReadPoints,
  type OwedWindow,
  roundRobinHooksOf,
  runWalkPlan,
  type SpanCommit,
  type SpanRead,
  type WalkMarks,
  type WalkPass,
  type WalkPlan,
  type WalkResult,
  type WalkWindow,
  type WindowOutcome,
  walkSpans,
} from './walk';
import type { WalkMarkWriter } from './exchange-state-deps';

type PlanContext<Lane extends string, Cost> = {
  deps: { now: () => number };
  run: { budget: Pick<RunBudget<Lane, Cost, unknown>, 'canAfford'> };
  accountId: string;
  marks: WalkMarks;
  plan: WalkPlan;
  write: WalkMarkWriter;
};

/**
 * Run an exchange walk's plan: each window is read span by span and committed, on the lane's
 * budget and while the account is not cooling down. `isCoolingDown` and `isUnreadableWindowError`
 * are the exchange's own (its rate-limit memory and the one failure of an owed window the walk
 * reads on past); `callsOf` and `owedFirst` are the walk's own (see `runWalkPlan`).
 */
export const runExchangeWalkPlan = <Page, Lane extends string, Cost>(input: {
  context: PlanContext<Lane, Cost>;
  lane: Lane;
  cost: Cost;
  isCoolingDown: (accountId: string, now: number) => boolean;
  isUnreadableWindowError: (error: unknown) => boolean;
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
  outcomeOf?: (pass: WalkPass, window: OwedWindow, outcome: WindowOutcome) => WindowOutcome;
}): Promise<WalkResult> => {
  const { context, lane, cost, read, commit } = input;
  const { deps, run, accountId, plan, marks, write } = context;

  return runWalkPlan({
    plan,
    callsOf: input.callsOf,
    owedFirst: input.owedFirst,
    readOnPastUnreadableForward: input.readOnPastUnreadableForward,
    canAfford: (keep) =>
      run.budget.canAfford(lane, cost, keep) && !input.isCoolingDown(accountId, deps.now()),
    runWindow: async (window, pass, keep, hint) => {
      const outcome = await walkSpans({
        window,
        read: (span, keepCalls) => read(window, span, keepCalls),
        commit: (span, page) => commit(window, span, page, pass),
        keep,
        hint,
        onComplete: (readPoints) =>
          dropReadPoints({
            pass,
            window,
            read: readPoints,
            marks,
            write,
          }),
      });

      return input.outcomeOf?.(pass, window, outcome) ?? outcome;
    },
    isUnreadableWindowError: input.isUnreadableWindowError,
    ...roundRobinHooksOf({ marks, write }),
  });
};
