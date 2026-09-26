// `replaceAll`/`refreshBondRegisterIfStale` run their writes through the
// `write` helper (one op-sqlite transaction). Override `write` to run the
// callback against a fake transaction handle backed by an in-memory store —
// mirrors `src/prices/price-points-repo/price-points.repo.test.ts`.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import type { BondTerms } from '../nbu-register';

import {
  bondRegisterRepo,
  refreshBondRegisterIfStale,
  type RefreshBondRegisterDeps,
} from './bond-register.repo';

const dcpTerms: BondTerms = {
  isin: 'UA4000234215',
  currency: 'UAH',
  faceValueMinorUnits: 100_000,
  couponPct: 15.1,
  maturityDate: Date.UTC(2026, 5, 24),
  couponFrequency: 'semiannually',
  name: 'Середньострокові UA4000234215',
};

describe('bondRegisterRepo', () => {
  it('builds a where-isin query against the bond_register table', () => {
    const sql = bondRegisterRepo.findByIsinQuery('UA4000234215').toSQL().sql;

    expect(sql).toContain('bond_register');
    expect(sql).toContain('isin');
  });

  it('builds a fetchedAt query against the bond_register table', () => {
    expect(bondRegisterRepo.fetchedAtQuery().toSQL().sql).toContain('bond_register');
  });

  it('replaces the whole cache in one transaction: delete first, then insert', async () => {
    const calls: string[] = [];
    mockDatabaseTransaction = {
      delete: () => {
        calls.push('delete');

        return Promise.resolve();
      },
      insert: () => ({
        values: (rows: unknown[]) => {
          calls.push(`insert:${rows.length}`);

          return Promise.resolve();
        },
      }),
    };

    await bondRegisterRepo.replaceAll([{ isin: dcpTerms.isin, terms: dcpTerms, fetchedAt: 1_000 }]);

    expect(calls).toEqual(['delete', 'insert:1']);
  });

  it('deletes the stale cache without inserting for an empty replacement (a matured/delisted ISIN drops out)', async () => {
    const calls: string[] = [];
    mockDatabaseTransaction = {
      delete: () => {
        calls.push('delete');

        return Promise.resolve();
      },
      insert: () => ({
        values: () => {
          calls.push('insert');

          return Promise.resolve();
        },
      }),
    };

    await bondRegisterRepo.replaceAll([]);

    expect(calls).toEqual(['delete']);
  });
});

describe('refreshBondRegisterIfStale', () => {
  // The gate compares `dayKeyOf`'s LOCAL calendar day. A raw `Date.UTC(...)`
  // instant only keeps its intended same-day/next-day labeling for a
  // UTC-1..UTC+3 host offset (the original bug this review round fixed), and
  // mid-test `process.env.TZ = '<zone>'` pinning (the pattern several other
  // date tests in this repo use, e.g. `price-book.test.ts`) does NOT
  // reliably re-target `Date`'s local getters inside this project's Jest
  // environment (`jest-environment-node`'s VM context appears to snapshot
  // the ICU timezone at worker start and ignore a later env mutation —
  // verified directly: `Intl.DateTimeFormat().resolvedOptions().timeZone`
  // inside a test still reports the ORIGINAL host zone after reassigning
  // `process.env.TZ`). So these instants are built through the LOCAL `Date`
  // constructor instead: `day1`/`laterSameDay` always share one local
  // calendar day, and `nextDay` always falls on the next one, regardless of
  // the host's actual timezone — genuinely deterministic, not pinned.
  const day1 = new Date(2026, 8, 24, 10, 0, 0).getTime();
  const laterSameDay = new Date(2026, 8, 24, 20, 0, 0).getTime();
  const nextDay = new Date(2026, 8, 25, 1, 0, 0).getTime();

  // Mirrors `rates-refresh.test.ts`'s/`metal-refresh.test.ts`'s `makeDeps`:
  // every test overrides only the fields its own scenario cares about.
  const makeDeps = (overrides: Partial<RefreshBondRegisterDeps> = {}): RefreshBondRegisterDeps => ({
    now: () => day1,
    fetchedAt: () => Promise.resolve(null),
    fetchRegister: jest.fn().mockResolvedValue([]),
    replaceAll: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it('skips the fetch when the cache was already refreshed on the SAME local day', async () => {
    const deps = makeDeps({ now: () => laterSameDay, fetchedAt: () => Promise.resolve(day1) });

    await refreshBondRegisterIfStale(deps);

    expect(deps.fetchRegister).not.toHaveBeenCalled();
    expect(deps.replaceAll).not.toHaveBeenCalled();
  });

  it('fetches and replaces the cache when the last refresh was a PRIOR local day', async () => {
    const deps = makeDeps({
      now: () => nextDay,
      fetchedAt: () => Promise.resolve(day1),
      fetchRegister: jest.fn().mockResolvedValue([dcpTerms]),
    });

    await refreshBondRegisterIfStale(deps);

    expect(deps.fetchRegister).toHaveBeenCalledTimes(1);
    expect(deps.replaceAll).toHaveBeenCalledWith([
      { isin: dcpTerms.isin, terms: dcpTerms, fetchedAt: nextDay },
    ]);
  });

  it('fetches when the cache has never been refreshed (no fetchedAt row yet)', async () => {
    const deps = makeDeps({ fetchRegister: jest.fn().mockResolvedValue([dcpTerms]) });

    await refreshBondRegisterIfStale(deps);

    expect(deps.fetchRegister).toHaveBeenCalledTimes(1);
    expect(deps.replaceAll).toHaveBeenCalledTimes(1);
  });

  it('passes the injected fetchImpl through to fetchRegister', async () => {
    const spyFetchImpl = (async () => ({})) as unknown as typeof fetch;
    const deps = makeDeps({ fetchImpl: spyFetchImpl });

    await refreshBondRegisterIfStale(deps);

    expect(deps.fetchRegister).toHaveBeenCalledWith(spyFetchImpl);
  });

  it('leaves the cache untouched when the fetch returns zero rows (never wipes a good cache)', async () => {
    const deps = makeDeps({
      now: () => nextDay,
      fetchedAt: () => Promise.resolve(day1),
      fetchRegister: jest.fn().mockResolvedValue([]),
    });

    await refreshBondRegisterIfStale(deps);

    expect(deps.fetchRegister).toHaveBeenCalledTimes(1);
    expect(deps.replaceAll).not.toHaveBeenCalled();
  });
});
