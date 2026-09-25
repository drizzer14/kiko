/**
 * Gates a screen's rendered content on one or more `useLiveQuery`/
 * `usePriceBook` `isLoading` flags at once: not ready while ANY of them is
 * still loading, ready once every one of them has settled — see
 * `kiko-architecture`'s useLiveQuery consumer rule.
 *
 * No latch. `useLiveQuery`'s own `isLoading` is PER-KEY: it goes true again
 * on a genuine sql/paramsKey change, never on a reactive re-run against the
 * SAME key — see `use-live-query.ts`. In holding-detail, for example,
 * `accountsRepo.byIdQuery(holding?.accountId ?? '')` re-keys the instant
 * `holdings` itself has just loaded — and that account query's OWN
 * `isLoading` flips back to true on that same re-key, so this `useDataReady`
 * call is already not-ready for that render without any latch. Every
 * current consumer's dependent query re-keys only while at least one of ITS
 * OWN other flags (the one whose data it re-keys off of) is still loading in
 * that same render, so this gate can never flip back to not-ready once every
 * flag has settled — the earlier ref-latched implementation was defensive
 * scaffolding for a case that never actually occurs, now that the flip lives
 * in the right layer (`useLiveQuery` itself).
 */
export const useDataReady = (...loadingFlags: boolean[]): boolean =>
  !loadingFlags.some((isLoading) => isLoading);
