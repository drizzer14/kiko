import { useRef } from 'react';

/**
 * Gates a screen's rendered content on one or more `useLiveQuery`/
 * `usePriceBook` `isLoading` flags at once: not ready while ANY of them is
 * still on its first load, ready once every one of them has settled — see
 * `kiko-architecture`'s useLiveQuery consumer rule. Latched via a ref: once
 * every flag has gone false on the SAME render, the gate stays open even if
 * a later re-query flips one back to true. `useLiveQuery`'s own `isLoading`
 * is already first-load-only (it never sets back to true after its first
 * settle), so the latch is a defensive backstop, not something the current
 * callers rely on to correct a real flip.
 */
export const useDataReady = (...loadingFlags: boolean[]): boolean => {
  const readyRef = useRef(false);

  if (!readyRef.current && !loadingFlags.some((isLoading) => isLoading)) {
    readyRef.current = true;
  }

  return readyRef.current;
};
