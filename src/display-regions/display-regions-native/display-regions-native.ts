import { bifoldr, eitherSync } from 'fnts/either';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

export type HorizontalSizeClass = 'compact' | 'regular';

export type VerticalBarEdge = 'leading' | 'trailing' | 'none';

// The fold's gap between the two panes, in window points; null when the device is flat or has no
// fold.
export type FoldRegion = { x: number; y: number; width: number; height: number } | null;

export type DisplayRegionsSnapshot = {
  horizontalSizeClass: HorizontalSizeClass;
  verticalBarEdge: VerticalBarEdge;
  foldRegion: FoldRegion;
};

// What an older system, a binary built without the module, and a payload JS cannot read all
// mean: the ordinary single-window iPhone.
export const FALLBACK_SNAPSHOT: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'compact',
  verticalBarEdge: 'none',
  foldRegion: null,
};

const SIZE_CLASSES: readonly unknown[] = ['compact', 'regular'];
const BAR_EDGES: readonly unknown[] = ['leading', 'trailing', 'none'];
const FOLD_REGION_KEYS = ['x', 'y', 'width', 'height'] as const;

// Required on first use, not at import: `getEnforcing` throws on a binary built without the
// module, and importing this wrapper must never crash the app.
const loadNativeModule = (): Spec => require('@kiko/native-specs/NativeDisplayRegions').default;

const isFoldRegion = (candidate: unknown): candidate is FoldRegion => {
  if (candidate === null) {
    return true;
  }

  if (typeof candidate !== 'object') {
    return false;
  }

  const fields = candidate as Record<string, unknown>;

  return FOLD_REGION_KEYS.every((key) => typeof fields[key] === 'number');
};

const isSnapshot = (candidate: unknown): candidate is DisplayRegionsSnapshot => {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const fields = candidate as Record<string, unknown>;

  return (
    SIZE_CLASSES.includes(fields.horizontalSizeClass) &&
    BAR_EDGES.includes(fields.verticalBarEdge) &&
    isFoldRegion(fields.foldRegion)
  );
};

// The last payload and what it parsed to, so `getSnapshot` hands back one object for as long as
// the native side reports the same JSON. `useSyncExternalStore` needs that: a fresh object on
// every call would re-render forever.
const lastParse: { payload: string | undefined; snapshot: DisplayRegionsSnapshot } = {
  payload: undefined,
  snapshot: FALLBACK_SNAPSHOT,
};

const parseSnapshot = (payload: string | undefined): DisplayRegionsSnapshot => {
  if (payload === undefined) {
    return FALLBACK_SNAPSHOT;
  }

  if (payload === lastParse.payload) {
    return lastParse.snapshot;
  }

  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(payload)));
  const snapshot = isSnapshot(parsed) ? parsed : FALLBACK_SNAPSHOT;

  lastParse.payload = payload;
  lastParse.snapshot = snapshot;

  return snapshot;
};

export const displayRegionsNative = {
  // Read synchronously from the native side, so the first render already has the real layout. A
  // module that is missing yields the fallback, never a throw.
  getSnapshot: (): DisplayRegionsSnapshot =>
    parseSnapshot(bifoldr(eitherSync<unknown, string>(() => loadNativeModule().getSnapshot()))),

  // Returns the unsubscribe. Where the module is missing there is nothing to subscribe to, so the
  // unsubscribe does nothing.
  subscribe: (listener: (snapshot: DisplayRegionsSnapshot) => void): (() => void) => {
    const subscription = bifoldr(
      eitherSync<unknown, { remove: () => void }>(() =>
        loadNativeModule().onChange((payload) => listener(parseSnapshot(payload))),
      ),
    );

    return () => subscription?.remove();
  },
};
