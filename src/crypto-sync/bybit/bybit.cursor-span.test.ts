import { DAY_MS } from '@kiko/dates';
import { halfOf, type WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import { readCursorSpan } from './bybit.cursor-span';
import { BYBIT_REQUEST_INTERVAL_MS, createBybitHistoryRun } from './bybit.history-budget';

type Row = { id: string; times: number[] };

type Page = { rows: Row[]; nextPageCursor: string | undefined };

const SECOND_MS = 1_000;
const SPAN: WalkWindow = { start: 10 * DAY_MS, end: 12 * DAY_MS };
const INSIDE = SPAN.start + DAY_MS;
const BEFORE = SPAN.start - 1;
const AFTER = SPAN.end + 1;

const rowAt = (id: string, ...times: number[]): Row => ({ id, times });

const pageOf = (nextPageCursor: string | undefined, ...rows: Row[]): Page => ({
  rows,
  nextPageCursor,
});

const runOf = (sleep: (milliseconds: number) => Promise<void> = async () => undefined) =>
  createBybitHistoryRun({ now: () => 1_000, sleep });

/** Pages by the cursor they are asked with: `undefined` asks the first page. */
const pagesOf = (pages: Record<string, Page>) => {
  const asked: (string | undefined)[] = [];
  const readPage = jest.fn(async (cursor: string | undefined): Promise<Page> => {
    asked.push(cursor);

    return pages[cursor ?? 'first'] ?? pageOf(undefined);
  });

  return { readPage, asked };
};

const spendLane = (run: ReturnType<typeof runOf>, lane: 'capital' | 'transfer', calls: number) => {
  for (let call = 0; call < calls; call += 1) {
    run.budget.record(lane, {});
  }
};

const readOf = (
  readPage: (cursor: string | undefined) => Promise<Page>,
  overrides: Partial<Parameters<typeof readCursorSpan<Row>>[0]> = {},
) =>
  readCursorSpan<Row>({
    run: runOf(),
    lane: 'capital',
    span: SPAN,
    keep: 0,
    minSplitMs: DAY_MS,
    readPage,
    timesOf: (row) => row.times,
    reachOf: (span) => span,
    ...overrides,
  });

const rowsPage = (...rows: Row[]) => ({ kind: 'page', page: { kind: 'rows', rows } });

const DRIFT = { kind: 'page', page: { kind: 'drift' } };

describe('readCursorSpan: following the cursor', () => {
  it('asks the first page with no cursor, then each page with the cursor the last one gave', async () => {
    const { readPage, asked } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf('b', rowAt('2', INSIDE)),
      b: pageOf(undefined, rowAt('3', INSIDE)),
    });

    const read = await readOf(readPage);

    expect(asked).toEqual([undefined, 'a', 'b']);
    expect(read).toEqual(rowsPage(rowAt('1', INSIDE), rowAt('2', INSIDE), rowAt('3', INSIDE)));
  });

  it.each([
    { form: 'absent', cursor: undefined },
    { form: 'empty', cursor: '' },
  ])('ends the span at a page whose cursor is $form', async ({ cursor }) => {
    const { readPage, asked } = pagesOf({ first: pageOf(cursor, rowAt('1', INSIDE)) });

    const read = await readOf(readPage);

    expect(asked).toEqual([undefined]);
    expect(read).toEqual(rowsPage(rowAt('1', INSIDE)));
  });

  it('ends the span at a page with no row, whatever its cursor says', async () => {
    const { readPage, asked } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf('b'),
    });

    const read = await readOf(readPage);

    expect(asked).toEqual([undefined, 'a']);
    expect(read).toEqual(rowsPage(rowAt('1', INSIDE)));
  });

  it('ends at a page with no row even when its cursor repeats one already used', async () => {
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf('a'),
    });

    expect(await readOf(readPage)).toEqual(rowsPage(rowAt('1', INSIDE)));
  });

  it('waits at the gate before each page and counts each page as a call of the lane', async () => {
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const run = runOf(sleep);
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf('b', rowAt('2', INSIDE)),
      b: pageOf(undefined, rowAt('3', INSIDE)),
    });

    await readOf(readPage, { run, lane: 'transfer' });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(BYBIT_REQUEST_INTERVAL_MS);

    spendLane(run, 'transfer', 16);

    expect(run.budget.canAfford('transfer', {})).toBe(true);

    spendLane(run, 'transfer', 1);

    expect(run.budget.canAfford('transfer', {})).toBe(false);
  });

  it('counts a request that rejected as a call of the lane, and lets the error through', async () => {
    const run = runOf();
    const failure = new Error('refused');
    const readPage = jest.fn(async (_cursor: string | undefined): Promise<Page> => {
      throw failure;
    });

    await expect(readOf(readPage, { run, lane: 'transfer' })).rejects.toBe(failure);

    spendLane(run, 'transfer', 18);

    expect(run.budget.canAfford('transfer', {})).toBe(true);

    spendLane(run, 'transfer', 1);

    expect(run.budget.canAfford('transfer', {})).toBe(false);
  });
});

describe('readCursorSpan: page drift', () => {
  it('is a drift when a page repeats the cursor just used', async () => {
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf('a', rowAt('2', INSIDE)),
    });

    expect(await readOf(readPage)).toEqual(DRIFT);
  });

  it('is a drift when a page repeats an earlier cursor', async () => {
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf('b', rowAt('2', INSIDE)),
      b: pageOf('a', rowAt('3', INSIDE)),
    });

    expect(await readOf(readPage)).toEqual(DRIFT);
  });

  it.each([
    { place: 'before the start', time: BEFORE },
    { place: 'past the end', time: AFTER },
  ])('is a drift when a row lies $place by its only reading', async ({ time }) => {
    const { readPage } = pagesOf({ first: pageOf(undefined, rowAt('1', time)) });

    expect(await readOf(readPage)).toEqual(DRIFT);
  });

  it('is a drift when a row lies outside by both readings, and gives none of the rows read', async () => {
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf(undefined, rowAt('2', BEFORE, AFTER)),
    });

    expect(await readOf(readPage)).toEqual(DRIFT);
  });

  it.each([
    { reading: 'first', times: [INSIDE, AFTER] },
    { reading: 'second', times: [BEFORE, INSIDE] },
  ])('is no drift when the $reading reading of a row is in the span', async ({ times }) => {
    const { readPage } = pagesOf({ first: pageOf(undefined, rowAt('1', ...times)) });

    expect(await readOf(readPage)).toEqual(rowsPage(rowAt('1', ...times)));
  });

  it('is no drift for a row with no time, which a pending row can be', async () => {
    const { readPage } = pagesOf({
      first: pageOf(undefined, rowAt('pending'), rowAt('1', INSIDE)),
    });

    expect(await readOf(readPage)).toEqual(rowsPage(rowAt('pending'), rowAt('1', INSIDE)));
  });

  it('measures a row against the reach the caller gives for the span, not against the span', async () => {
    const { readPage } = pagesOf({
      first: pageOf(undefined, rowAt('late', AFTER), rowAt('floored', BEFORE)),
    });
    const reachOf = (span: WalkWindow): WalkWindow => ({
      start: span.start - SECOND_MS,
      end: Number.POSITIVE_INFINITY,
    });

    expect(await readOf(readPage, { reachOf })).toEqual(
      rowsPage(rowAt('late', AFTER), rowAt('floored', BEFORE)),
    );
  });

  it('keeps both ends of the reach inside it', async () => {
    const { readPage } = pagesOf({
      first: pageOf(undefined, rowAt('start', SPAN.start), rowAt('end', SPAN.end)),
    });

    expect(await readOf(readPage)).toEqual(
      rowsPage(rowAt('start', SPAN.start), rowAt('end', SPAN.end)),
    );
  });
});

describe('readCursorSpan: the budget', () => {
  it('returns undefined before the first page when the lane cannot afford it, and asks nothing', async () => {
    const run = runOf();
    const { readPage } = pagesOf({ first: pageOf(undefined, rowAt('1', INSIDE)) });

    spendLane(run, 'capital', 30);

    expect(await readOf(readPage, { run })).toBeUndefined();
    expect(readPage).not.toHaveBeenCalled();
  });

  it('never splits before a span read a page, whatever the span width', async () => {
    const run = runOf();
    const { readPage } = pagesOf({});

    spendLane(run, 'capital', 30);

    expect(
      await readOf(readPage, {
        run,
        span: { start: 0, end: 100 * DAY_MS },
        minSplitMs: SECOND_MS,
      }),
    ).toBeUndefined();
  });

  it('holds back the calls it is told to keep when it asks for a page', async () => {
    const run = runOf();
    const { readPage } = pagesOf({ first: pageOf(undefined, rowAt('1', INSIDE)) });

    spendLane(run, 'capital', 27);

    expect(await readOf(readPage, { run, keep: 3 })).toBeUndefined();
    expect(readPage).not.toHaveBeenCalled();
    expect(await readOf(readPage, { run, keep: 2 })).toEqual(rowsPage(rowAt('1', INSIDE)));
  });

  it('splits to the first half of a span wider than the minimum when the next page is unaffordable', async () => {
    const run = runOf();
    const { readPage, asked } = pagesOf({
      first: pageOf('a', rowAt('1', INSIDE)),
      a: pageOf(undefined, rowAt('2', INSIDE)),
    });

    spendLane(run, 'capital', 29);

    const read = await readOf(readPage, { run });

    expect(asked).toEqual([undefined]);
    expect(read).toEqual({ kind: 'split', half: halfOf(SPAN) });
  });

  it('ends the span with its rows when the last page is the last the lane can afford', async () => {
    const run = runOf();
    const { readPage } = pagesOf({ first: pageOf(undefined, rowAt('1', INSIDE)) });

    spendLane(run, 'capital', 29);

    expect(await readOf(readPage, { run })).toEqual(rowsPage(rowAt('1', INSIDE)));
  });

  it('splits only a span wider than the minimum split it is given', async () => {
    const wide = { start: 0, end: DAY_MS + 1 };
    const exact = { start: 0, end: DAY_MS };
    const narrow = { start: 0, end: DAY_MS - 1 };

    const readAt = async (span: WalkWindow) => {
      const run = runOf();
      const { readPage } = pagesOf({
        first: pageOf('a', rowAt('1', span.start)),
        a: pageOf(undefined, rowAt('2', span.start)),
      });

      spendLane(run, 'capital', 29);

      return readOf(readPage, { run, span });
    };

    expect(await readAt(wide)).toEqual({ kind: 'split', half: halfOf(wide) });
    expect(await readAt(exact)).toBeUndefined();
    expect(await readAt(narrow)).toBeUndefined();
  });

  it('takes the minimum split from the caller: a second for a log span, a day for a capital span', async () => {
    const span = { start: 0, end: 10 * SECOND_MS };

    const readWith = async (minSplitMs: number) => {
      const run = runOf();
      const { readPage } = pagesOf({
        first: pageOf('a', rowAt('1', 0)),
        a: pageOf(undefined, rowAt('2', 0)),
      });

      spendLane(run, 'capital', 29);

      return readOf(readPage, { run, span, minSplitMs });
    };

    expect(await readWith(SECOND_MS)).toEqual({ kind: 'split', half: halfOf(span) });
    expect(await readWith(DAY_MS)).toBeUndefined();
  });

  it('signals the caller when a span at the minimum cannot go on, once it has read a page', async () => {
    const run = runOf();
    const onFirstReadStuck = jest.fn();
    const span = { start: 0, end: SECOND_MS };
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', 0)),
      a: pageOf(undefined, rowAt('2', 0)),
    });

    spendLane(run, 'capital', 29);

    expect(
      await readOf(readPage, { run, span, minSplitMs: SECOND_MS, onFirstReadStuck }),
    ).toBeUndefined();
    expect(onFirstReadStuck).toHaveBeenCalledTimes(1);
    expect(onFirstReadStuck).toHaveBeenCalledWith(span);
  });

  it('reads on for a caller that gave no signal, as capital and transfer give none', async () => {
    const run = runOf();
    const span = { start: 0, end: SECOND_MS };
    const { readPage } = pagesOf({
      first: pageOf('a', rowAt('1', 0)),
      a: pageOf(undefined, rowAt('2', 0)),
    });

    spendLane(run, 'capital', 29);

    expect(await readOf(readPage, { run, span, minSplitMs: SECOND_MS })).toBeUndefined();
  });

  it('gives no signal when the span splits, nor before its first page, nor when it ends', async () => {
    const onFirstReadStuck = jest.fn();
    const twoPages = {
      first: pageOf('a', rowAt('1', 0)),
      a: pageOf(undefined, rowAt('2', 0)),
    };

    const spent = runOf();
    spendLane(spent, 'capital', 29);
    await readOf(pagesOf(twoPages).readPage, {
      run: spent,
      span: { start: 0, end: 10 * SECOND_MS },
      minSplitMs: SECOND_MS,
      onFirstReadStuck,
    });

    const empty = runOf();
    spendLane(empty, 'capital', 30);
    await readOf(pagesOf(twoPages).readPage, {
      run: empty,
      span: { start: 0, end: SECOND_MS },
      minSplitMs: SECOND_MS,
      onFirstReadStuck,
    });

    await readOf(pagesOf({ first: pageOf(undefined, rowAt('1', 0)) }).readPage, {
      span: { start: 0, end: SECOND_MS },
      minSplitMs: SECOND_MS,
      onFirstReadStuck,
    });

    expect(onFirstReadStuck).not.toHaveBeenCalled();
  });
});
