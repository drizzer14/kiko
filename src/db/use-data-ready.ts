/**
 * Gates a screen's rendered content on one or more `useLiveQuery`/
 * `usePriceBook` `isLoading` flags at once: not ready while ANY of them is
 * still loading, ready once every one of them has settled — see
 * `kiko-architecture`'s useLiveQuery consumer rule.
 *
 * No latch. `useLiveQuery`'s own `isLoading` is PER-KEY: it goes true again
 * on a genuine sql/paramsKey change (e.g. holding-detail's
 * `accountsRepo.byIdQuery(holding?.accountId ?? '')` re-keying the instant
 * `holdings` itself has just loaded), never on a reactive re-run against the
 * SAME key — see `use-live-query.ts`. Every current consumer's query key
 * only ever changes while at least one of its OWN other flags is still
 * loading in that same render (a dependent query's key derives from data
 * this same `useDataReady` call already gates), so this gate can never flip
 * back to not-ready once every flag has settled — the earlier ref-latched
 * implementation was defensive scaffolding for a case that never actually
 * occurs, now that the flip lives in the right layer (`useLiveQuery` itself).
 */
export const useDataReady = (...loadingFlags: boolean[]): boolean =>
  !loadingFlags.some((isLoading) => isLoading);
