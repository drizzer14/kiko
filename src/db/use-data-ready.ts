/**
 * Gates a screen's rendered content on one or more `useLiveQuery`/
 * `usePriceBook` `isLoading` flags at once: not ready while ANY of them is
 * still loading, ready once every one of them has settled — see
 * `kiko-architecture`'s useLiveQuery consumer rule.
 *
 * No latch here. `useLiveQuery`'s own `isLoading` is PER-KEY: it goes true again
 * on a genuine sql/paramsKey change, never on a reactive re-run against the
 * SAME key — see `use-live-query.ts`. In holding-detail, for example,
 * `accountsRepo.byIdQuery(holding?.accountId ?? '')` re-keys the instant
 * `holdings` itself has just loaded — and that account query's OWN
 * `isLoading` flips back to true on that same re-key, so this `useDataReady`
 * call is already not-ready for that render without any latch.
 *
 * So this gate goes not-ready again whenever any of its queries re-keys, even
 * after it was ready: a query keyed on something the user picks (Home's date
 * range) or on the clock (the local day) does exactly that. A screen that
 * would rather keep its content mounted over such a re-key latches its first
 * ready itself and shows a local loading state for the re-keyed read alone
 * (`home.screen.tsx`).
 */
export const useDataReady = (...loadingFlags: boolean[]): boolean =>
  !loadingFlags.some((isLoading) => isLoading);
