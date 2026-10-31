import { bifoldr, eitherSync } from 'fnts/either';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

export type HorizontalSizeClass = 'compact' | 'regular';

export type VerticalBarEdge = 'leading' | 'trailing' | 'none';

// The fold's gap between the two panes, in window points; null when the device is flat or has no
// fold.
export type FoldRegion = { x: number; y: number; width: number; height: number } | null;

// Where the tab bar sits in the window, read from its real frame; `none` means the native side
// could not tell, so JS keeps its older rule.
export type TabBarEdge = 'top' | 'bottom' | 'leading' | 'trailing' | 'none';

export type DisplayRegionsSnapshot = {
  horizontalSizeClass: HorizontalSizeClass;
  verticalBarEdge: VerticalBarEdge;
  tabBarEdge: TabBarEdge;
  foldRegion: FoldRegion;
};

// What an older system, a binary built without the module, and a payload JS cannot read all
// mean: the ordinary single-window iPhone.
export const FALLBACK_SNAPSHOT: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'compact',
  verticalBarEdge: 'none',
  tabBarEdge: 'none',
  foldRegion: null,
};

const SIZE_CLASSES: readonly unknown[] = ['compact', 'regular'];
const BAR_EDGES: readonly unknown[] = ['leading', 'trailing', 'none'];
const TAB_BAR_EDGES: readonly unknown[] = ['top', 'bottom', 'leading', 'trailing', 'none'];
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
    TAB_BAR_EDGES.includes(fields.tabBarEdge) &&
    isFoldRegion(fields.foldRegion)
  );
};

// A binary built before the tab bar edge sends no such key; the rest of its payload is still
// good, and dropping it would lose the fold. Only a missing key is defaulted, never a bad value.
const withTabBarEdge = (parsed: unknown): unknown => {
  if (typeof parsed !== 'object' || parsed === null || 'tabBarEdge' in parsed) {
    return parsed;
  }

  return { ...parsed, tabBarEdge: 'none' };
};

// The last payload and what it parsed to, so a payload equal to the last one parses to the same
// object. `subscribe` compares the snapshot it read before subscribing with the one it reads after
// by identity, and an unchanged payload must not look like a change.
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

  const parsed = withTabBarEdge(bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(payload))));
  const snapshot = isSnapshot(parsed) ? parsed : FALLBACK_SNAPSHOT;

  lastParse.payload = payload;
  lastParse.snapshot = snapshot;

  return snapshot;
};

const readNative = (): DisplayRegionsSnapshot =>
  parseSnapshot(bifoldr(eitherSync<unknown, string>(() => loadNativeModule().getSnapshot())));

// What JS knows of the native side. Every read crosses to the main thread synchronously, so it is
// taken once and then kept current from the `onChange` payloads; it is valid only while a
// subscriber is listening, and dropped with the last one.
const cache: { snapshot: DisplayRegionsSnapshot | undefined; subscriberCount: number } = {
  snapshot: undefined,
  subscriberCount: 0,
};

export const displayRegionsNative = {
  // Read from the native side on first use only, so the first render already has the real layout
  // and later renders cost nothing. A module that is missing yields the fallback, never a throw.
  getSnapshot: (): DisplayRegionsSnapshot => {
    cache.snapshot ??= readNative();

    return cache.snapshot;
  },

  // The first snapshot is read before the tab view mounts and nothing native fires when it
  // appears, so a hook asks for one more read. A missing module, or one built before the method,
  // is a no-op.
  requestRefresh: (): void => {
    bifoldr(eitherSync<unknown, void>(() => loadNativeModule().requestRefresh()));
  },

  // Returns the unsubscribe. Where the module is missing there is nothing to subscribe to, so the
  // unsubscribe does nothing.
  subscribe: (listener: (snapshot: DisplayRegionsSnapshot) => void): (() => void) => {
    const subscription = bifoldr(
      eitherSync<unknown, { remove: () => void }>(() =>
        loadNativeModule().onChange((payload) => {
          cache.snapshot = parseSnapshot(payload);
          listener(cache.snapshot);
        }),
      ),
    );

    if (cache.subscriberCount === 0) {
      // A change between the first read and this subscription raised no event.
      const readBeforeSubscribing = cache.snapshot;

      cache.snapshot = readNative();

      if (readBeforeSubscribing !== undefined && readBeforeSubscribing !== cache.snapshot) {
        listener(cache.snapshot);
      }
    }

    cache.subscriberCount += 1;

    return () => {
      subscription?.remove();
      cache.subscriberCount -= 1;

      if (cache.subscriberCount === 0) {
        cache.snapshot = undefined;
      }
    };
  },
};
