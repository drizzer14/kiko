import { envelopeOf } from './bybit.client-test-fixtures';
import { syncBybitConvertHistory } from './bybit.convert-history';
import { ACCOUNT_ID, historyRunAt, inMemoryWalkOf } from './bybit.capital-test-fixtures';

type SyncDeps = NonNullable<Parameters<typeof syncBybitConvertHistory>[1]>;

type Page = Record<string, unknown>[];

/**
 * What the fake route answers for an index past the last page: nothing, the page before, a wrap
 * that cycles through every page again, or a refusal of the class "any other".
 */
type PastEnd = 'empty' | 'repeat' | 'wrap' | 'refuse';

type RouteOptions = {
  pastEnd?: PastEnd;
  /** Answers one index with this code instead of its page. */
  refuseAt?: { index: number; retCode: number };
  /** Answers one index with an HTTP failure and a page that is not JSON (a gateway page). */
  httpFailAt?: { index: number; status: number };
};

/** A code the client does not know, so its class is "any other". */
export const UNKNOWN_REFUSAL_CODE = 10099;

const pastEndPageOf = (pastEnd: PastEnd, pages: Page[], index: number): Page => {
  if (pastEnd === 'repeat') {
    return pages.at(-1) ?? [];
  }

  return pastEnd === 'wrap' ? (pages[(index - 1) % pages.length] ?? []) : [];
};

/**
 * A Bybit that answers the convert route by `index` from the pages it is served (page 1 is the
 * first) and records the index of every read.
 */
export const convertRouteOf = (options: RouteOptions = {}) => {
  const { pastEnd = 'empty', refuseAt, httpFailAt } = options;
  const world = { pages: [] as Page[] };
  const indexes: number[] = [];

  const bodyOf = (index: number) => {
    const isPast = index > world.pages.length;

    if (refuseAt?.index === index || (pastEnd === 'refuse' && isPast)) {
      return envelopeOf(refuseAt?.index === index ? refuseAt.retCode : UNKNOWN_REFUSAL_CODE);
    }

    return envelopeOf(0, {
      list: isPast ? pastEndPageOf(pastEnd, world.pages, index) : world.pages[index - 1],
    });
  };

  const fetchImpl = (async (input: string) => {
    const index = Number(new URL(input).searchParams.get('index'));

    indexes.push(index);

    if (httpFailAt?.index === index) {
      return {
        ok: false,
        status: httpFailAt.status,
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      };
    }

    return { ok: true, status: 200, headers: new Headers(), json: async () => bodyOf(index) };
  }) as unknown as typeof fetch;

  return {
    indexes,
    fetchImpl,
    /** The pages the route answers with from now on, page 1 first. */
    serve: (pages: Page[]): void => {
      world.pages = pages;
    },
  };
};

type WalkOptions = RouteOptions & {
  /** The walk state of the account: a `walkStateFake`, made by the test. */
  state: Parameters<typeof inMemoryWalkOf>[0]['state'] & {
    marksOf: (walkName: 'convert') => Record<string, unknown>;
  };
  now?: number;
  /** Replaces a dependency of the walk. */
  overrides?: Partial<SyncDeps>;
  /** See `inMemoryWalkOf`. */
  beforeWrite?: (writeNumber: number) => void;
};

/**
 * One account's convert walk on the in-memory world, over the fake route: the rows it adds, the
 * holdings it creates, and the walk state it writes.
 */
export const convertWalkOf = (options: WalkOptions) => {
  const route = convertRouteOf(options);
  const world = inMemoryWalkOf({
    state: options.state,
    now: options.now,
    beforeWrite: options.beforeWrite,
  });
  const deps = { ...world.deps, fetchImpl: route.fetchImpl, ...options.overrides };

  const run = (accountId = ACCOUNT_ID) =>
    syncBybitConvertHistory({ targetAccountId: accountId, run: historyRunAt(world.clock) }, deps);

  return {
    ...world,
    deps,
    run,
    serve: route.serve,
    indexes: route.indexes,
    marks: () => options.state.marksOf('convert'),
    /** The stored state text of the account, as the walk reads it. */
    readState: () => world.deps.readExchangeState(ACCOUNT_ID),
  };
};
