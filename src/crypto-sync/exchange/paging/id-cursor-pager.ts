import type { ExchangeRun } from '../budget';

type IdCursorPageErrorCode =
  | 'not-safe-integer'
  | 'not-ascending'
  | 'over-limit'
  | 'stop-out-of-page';

/**
 * A page the pager cannot trust. A class of its own, because a swallowed failure logs only the
 * error's name and code: the message carries the code and never an id.
 */
export class IdCursorPageError extends Error {
  public readonly code: IdCursorPageErrorCode;

  constructor(code: IdCursorPageErrorCode) {
    super(`id-cursor-page: ${code}`);
    this.name = 'IdCursorPageError';
    this.code = code;
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, IdCursorPageError.prototype);
  }
}

/** What the caller answers once it has committed a page: read on, or stop at `stopAt`. */
type IdCursorDecision = 'next' | { stopAt: number };

type IdCursorEnd = 'short-page' | 'budget' | 'stopped';

/**
 * The ids of a page, each checked: a safe integer whose successor is one too (the cursor is the
 * last id plus one, and an unsafe cursor would round), strictly ascending from the cursor the
 * page was asked from (so one id below it is out of order too). A page with more rows than
 * `limit` is off contract as well.
 */
const checkedIdsOf = <Row>(
  rows: Row[],
  idOf: (row: Row) => unknown,
  fromId: number,
  limit: number,
): number[] => {
  if (rows.length > limit) {
    throw new IdCursorPageError('over-limit');
  }

  let floor = fromId;

  return rows.map((row) => {
    const id = idOf(row);

    if (typeof id !== 'number' || !Number.isSafeInteger(id) || !Number.isSafeInteger(id + 1)) {
      throw new IdCursorPageError('not-safe-integer');
    }

    if (id < floor) {
      throw new IdCursorPageError('not-ascending');
    }

    floor = id + 1;

    return id;
  });
};

/**
 * Read a list that pages by an id cursor (`fromId`, the first id wanted, a page of at most `limit`
 * rows in ascending id order), from `fromId` until a page is short, the lane cannot afford the
 * next page (with `keep` calls left after it), or the caller stops. Every page is a call of the
 * lane, asked of the budget and then the shared gate, and recorded once it answers, even if its
 * rows are refused. The caller commits each page in `onPage` before the next is asked, so a
 * failure later loses no committed page; a page is never handed over unless all of its ids passed
 * `idOf` (read as `unknown`, so the wire type is checked here, not trusted): a bad page throws
 * `IdCursorPageError`. `nextFromId` is the id after the last row handed over, the `fromId` asked
 * when none came, or the `stopAt` the caller answered with. A `fromId` that is not a safe integer
 * is refused before the lane is asked for anything, and so is a `stopAt` that is not a safe
 * integer in `[the page's fromId, its last id + 1]` (code `stop-out-of-page`), because the cursor
 * it leaves is the one the next read starts from.
 */
export const readIdCursor = async <Row, Lane extends string, Cost, Weights>(input: {
  run: ExchangeRun<Lane, Cost, Weights>;
  lane: Lane;
  cost: Cost;
  keep: number;
  fromId: number;
  limit: number;
  fetchPage: (fromId: number) => Promise<{ rows: Row[] } & Weights>;
  idOf: (row: Row) => unknown;
  onPage: (page: { rows: Row[]; nextFromId: number }) => Promise<IdCursorDecision>;
}): Promise<{ nextFromId: number; calls: number; end: IdCursorEnd }> => {
  const { run, lane, cost, keep, limit, fetchPage, idOf, onPage } = input;
  let nextFromId = input.fromId;
  let calls = 0;

  if (!Number.isSafeInteger(nextFromId)) {
    throw new IdCursorPageError('not-safe-integer');
  }

  for (;;) {
    if (!run.budget.canAfford(lane, cost, keep)) {
      return { nextFromId, calls, end: 'budget' };
    }

    await run.gate.wait();
    const page = await fetchPage(nextFromId);

    calls += 1;
    run.budget.record(lane, page);

    const ids = checkedIdsOf(page.rows, idOf, nextFromId, limit);

    if (ids.length === 0) {
      return { nextFromId, calls, end: 'short-page' };
    }

    const afterPage = ids[ids.length - 1] + 1;
    const decision = await onPage({ rows: page.rows, nextFromId: afterPage });

    if (decision !== 'next') {
      const { stopAt } = decision;

      if (!Number.isSafeInteger(stopAt) || stopAt < nextFromId || stopAt > afterPage) {
        throw new IdCursorPageError('stop-out-of-page');
      }

      return { nextFromId: stopAt, calls, end: 'stopped' };
    }

    nextFromId = afterPage;

    if (ids.length < limit) {
      return { nextFromId, calls, end: 'short-page' };
    }
  }
};
