import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { denseSpansOf } from '@kiko/crypto-sync/exchange/history-status';
import type { OwedWindow, SpanRead, WalkWindow } from '@kiko/crypto-sync/exchange/walk';
import { type DenseSeries, parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';

import { readCursorSpan } from './bybit.cursor-span';
import type { BybitLane } from './bybit.history-budget';
import { type BybitWalkContext, type BybitWalkDeps, readUnderCooldown } from './bybit.walk-run';

type DenseContext = Pick<BybitWalkContext<BybitWalkDeps>, 'deps' | 'accountId' | 'plan'>;

/**
 * The mark of a dense span of one series, read once per run and kept in step with what this run
 * writes: whether the stored mark stands decides every write, so a span that stays stuck writes
 * nothing after the first run.
 */
export const denseMarkOf = (series: DenseSeries) => {
  let stored: number | undefined;
  let isRead = false;
  let forwardReads = 0;

  const startOf = async ({ deps, accountId }: DenseContext): Promise<number | undefined> => {
    if (!isRead) {
      stored = denseSpansOf(parseExchangeState(await deps.readExchangeState(accountId)))[series];
      isRead = true;
    }

    return stored;
  };

  const write = async ({ deps, accountId }: DenseContext, start: number | null): Promise<void> => {
    await deps.patchExchangeState(accountId, [{ kind: 'denseSpans', series, start }]);
    stored = start ?? undefined;
  };

  return {
    /**
     * Whether this read is the first of the run's forward pass. Only there does a full lane that
     * did not hold a span say the span is too dense: a read after another had less than the lane.
     */
    isFirstForwardRead: ({ plan }: DenseContext, window: OwedWindow): boolean => {
      if (!plan.forward.includes(window)) {
        return false;
      }

      forwardReads += 1;

      return forwardReads === 1;
    },
    mark: async (context: DenseContext, start: number): Promise<void> => {
      if ((await startOf(context)) !== start) {
        await write(context, start);
      }
    },
    /** A commit that ends past the mark's start has moved the cursor past the span. */
    dropPast: async (context: DenseContext, end: number): Promise<void> => {
      const start = await startOf(context);

      if (start !== undefined && end > start) {
        await write(context, null);
      }
    },
  };
};

export type DenseMark = ReturnType<typeof denseMarkOf>;

/** The items of a read span, or a drift: a repeated cursor or a row outside its reach. */
export type DenseSpanRecords<Item> = { items: Item[]; drifted: boolean };

type DenseSpanRead<Item> = {
  context: Pick<BybitWalkContext<BybitWalkDeps>, 'deps' | 'accountId' | 'run' | 'plan'>;
  lane: BybitLane;
  span: WalkWindow;
  keep: number;
  window: OwedWindow;
  /** The forward pass's split, and the split of every other read (pending, re-scan, point). */
  minSplitMs: { forward: number; reread: number };
  readPage: (cursor: string | undefined) => Promise<{
    rows: Item[];
    nextPageCursor: string | undefined;
  }>;
  reachOf: (span: WalkWindow) => WalkWindow;
  /** The key of an item, for a series that ends a span at a repeated cursor (`readCursorSpan`). */
  keyOf?: (item: Item) => string | undefined;
  dense: { mark: DenseMark['mark']; isFirstForwardRead: boolean };
};

/**
 * One span read, a page at a time, in a lane that marks a dense span. `undefined` is a clean stop
 * (the budget ran out, or Bybit rate-limited and the account cools). A page that drifted is no one
 * row's stop: it gives no item and the span is owed.
 */
export const readDenseSpan = <Item extends { times: readonly number[] }>(
  input: DenseSpanRead<Item>,
): Promise<SpanRead<DenseSpanRecords<Item>> | undefined> =>
  readUnderCooldown(input.context, async () => {
    const { context, lane, span, keep, window, minSplitMs, readPage, reachOf, dense } = input;
    const { keyOf } = input;
    const stuck: WalkWindow[] = [];
    const read = await readCursorSpan<Item>({
      run: context.run,
      lane,
      span,
      keep,
      minSplitMs: context.plan.forward.includes(window) ? minSplitMs.forward : minSplitMs.reread,
      readPage,
      timesOf: (item) => item.times,
      reachOf,
      keyOf,
      ...(dense.isFirstForwardRead
        ? { onFirstReadStuck: (found: WalkWindow) => stuck.push(found) }
        : {}),
    });

    await foldMap(maybe(stuck.at(0)), (found) => dense.mark(context, found.start));

    if (read === undefined || read.kind === 'split') {
      return read;
    }

    return {
      kind: 'page',
      page: match(read.page)
        .returnType<DenseSpanRecords<Item>>()
        .with({ kind: 'drift' }, () => ({ items: [], drifted: true }))
        .with({ kind: 'rows' }, ({ rows }) => ({ items: rows, drifted: false }))
        .exhaustive(),
    };
  });
