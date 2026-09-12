// FIRST-PAINT RE-SAMPLE hook (device bug, confirmed 2026-09-12 on the
// categories screen's `Sortable.Grid`-managed card). `bloom` on the real
// glass path renders a backdrop-less `LiquidGlassView` with `effect="clear"`
// (see `glassEffect`/`base` in `glass-surface.component.tsx`). A
// `'clear'`-effect glass samples its backdrop exactly once, at native
// layout — there is no imperative re-sample API. A surface that mounts
// inside `react-native-sortables`' `Sortable.Grid` (the category card) is
// MEASURED by Sortable first, then transform-repositioned into its real
// on-screen spot; the glass's one-shot sample fires during that measure
// pass, before the transform lands, capturing nothing solid — the card then
// reads fully transparent until an unrelated event (a drag, which teleports
// the card into a portal and remounts a fresh `LiquidGlassView` already in
// its real position) forces a second sample. `remountToken` flips EXACTLY
// ONCE, once the surface's real on-screen position has settled (see the
// effect below), forcing React to tear down and recreate the
// `LiquidGlassView` with a fresh `key` so the fresh view lays out — and
// samples — in the surface's real, final position. Scoped to `needsResample`
// (glass-path `bloom` only): every other variant is already pinned by its
// own backdrop/wash layer on the first frame and never needed a second
// native remount.
//
// Extracted out of `GlassSurface` itself so its hooks are called
// UNCONDITIONALLY before that component's `isStableGlass()` early return
// (see the component's own top-of-function call site) — keeping this block
// as its own custom hook is what lets the early return stay a true early
// return without a rules-of-hooks violation, and keeps `GlassSurface`'s own
// cognitive complexity under budget.
import { useEffect, useRef, useState } from 'react';
import type { ViewInstance } from 'react-native';

import {
  isPositionSettled,
  type ScreenPosition,
  shouldStopResampling,
} from './glass-surface.resample';

export const useBloomResample = (needsResample: boolean) => {
  const [remountToken, setRemountToken] = useState(0);
  const hasResampled = useRef(false);
  const surfaceRef = useRef<ViewInstance>(null);

  useEffect(() => {
    if (!needsResample || hasResampled.current) {
      return;
    }

    let frame: number | undefined;
    let cancelled = false;
    let attempt = 0;
    let lastPosition: ScreenPosition | undefined;

    const resample = () => {
      hasResampled.current = true;
      setRemountToken((token) => token + 1);
    };

    // Condition-based settle check, not a fixed frame count: a
    // `Sortable.Grid` item is positioned by a Reanimated TRANSFORM computed
    // from the cumulative measured heights of every preceding card, which
    // settles progressively — a card further down the grid can take several
    // more frames than a card near the top, so a fixed 2-frame delay races
    // (and loses, for lower cards) an animation with no fixed duration.
    // `measureInWindow` reads the REAL composited on-screen position (it
    // includes the live transform, unlike `onLayout`, which does not re-fire
    // for a transform-only move). `isPositionSettled`/`shouldStopResampling`
    // (`glass-surface.resample.ts`) hold the actual settle/cap decision as
    // plain, synchronously-testable functions — this closure is only the
    // thin adapter wiring them into `measureInWindow` and
    // `requestAnimationFrame`.
    const checkSettled = () => {
      if (cancelled) {
        return;
      }

      attempt += 1;
      surfaceRef.current?.measureInWindow((x, y) => {
        if (cancelled) {
          return;
        }

        const current: ScreenPosition = { x, y };

        if (shouldStopResampling(attempt, isPositionSettled(lastPosition, current))) {
          resample();
          return;
        }

        lastPosition = current;
        frame = requestAnimationFrame(checkSettled);
      });
    };

    frame = requestAnimationFrame(checkSettled);

    return () => {
      cancelled = true;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [needsResample]);

  return { remountToken, surfaceRef };
};
