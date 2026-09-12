// Pure decision math for the `bloom` first-paint re-sample (see the
// `needsResample` block in `glass-surface.component.tsx`), extracted the same
// way `swipeable-row/gesture.ts` and `bottom-sheet/bottom-sheet.gesture.ts`
// extract their own resting-state/activation-threshold math: plain functions
// with no dependency on a native ref, `requestAnimationFrame`, or any React
// state, so the decision itself is synchronously unit-testable with plain
// numbers, and the component only wires it into the native measure loop as a
// thin adapter.

export type ScreenPosition = { x: number; y: number };

// The upper bound on the settle-check loop: a `Sortable.Grid` item's position
// transform normally settles well inside this many frames, but the cap
// exists so the loop provably terminates even if it never does — the surface
// remounts and re-samples anyway once this many frames have passed, rather
// than waiting forever for a settle that might not come.
export const MAX_SETTLE_ATTEMPTS = 30;

// Two consecutive reads at the identical on-screen position mean whatever
// moved it (a Reanimated transform, in the one confirmed case) has stopped —
// `previous` is `undefined` on the very first read, so at least two attempts
// are always required before this can report settled.
export const isPositionSettled = (
  previous: ScreenPosition | undefined,
  current: ScreenPosition,
): boolean => previous !== undefined && previous.x === current.x && previous.y === current.y;

// Stop the loop either because the position has settled, or because the
// bounded attempt cap was reached — whichever comes first. A capped-out loop
// still resamples (see the doc on `MAX_SETTLE_ATTEMPTS`), it just does so
// without having observed a settle.
export const shouldStopResampling = (attempt: number, settled: boolean): boolean =>
  settled || attempt >= MAX_SETTLE_ATTEMPTS;
