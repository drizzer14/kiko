import { useSyncExternalStore } from 'react';

/**
 * A tiny module-level store for the TRANSIENT "a sync run is in flight" UI
 * signal. It is deliberately NOT a database row and NOT a live query: nothing
 * about a run-in-progress is persisted, and it must flip long before any row is
 * written. It now rides the progress SESSION below (`beginProgressSession` lights
 * it on the first contributor, `endProgressSession` clears it on the last), so it
 * spans the WHOLE fan-out — the Monobank `runSync` plus any concurrent crypto
 * `runBalanceSync` — not the Monobank run alone. Any trigger (auto-sync on open,
 * pull-to-refresh, the manual button, a crypto-only fan-out) lights the same
 * signal; every subscribed indicator observes it through `useSyncStatus()`.
 *
 * The `subscribe`/`getSnapshot`/`setSyncing` triple is shaped for React's
 * `useSyncExternalStore`: `subscribe` and `getSnapshot` are stable
 * module-level functions (never re-created per render), so the hook never
 * re-subscribes needlessly.
 */
type Listener = () => void;

let isSyncing = false;
const listeners = new Set<Listener>();

/** Flip the shared flag; notifies subscribers only on an actual change. */
export const setSyncing = (next: boolean): void => {
  if (isSyncing === next) {
    return;
  }
  isSyncing = next;
  for (const listener of listeners) {
    listener();
  }
};

/** Register a change listener; the returned function unsubscribes it. */
export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The current flag, read synchronously (the `useSyncExternalStore` snapshot). */
export const getSnapshot = (): boolean => isSyncing;

/** `true` while a Monobank sync is in flight, reactively tracked. */
export const useSyncStatus = (): boolean => useSyncExternalStore(subscribe, getSnapshot);

/**
 * The DETERMINATE progress of the current run, counted in HOLDINGS (not cards):
 * `total` is the number of holdings the user sees (active holdings across every
 * account), and `completed` STARTS at the holdings that do NOT require syncing
 * and rises by one as each syncable holding's balance/statements commit. So 3
 * holdings with 1 syncable holding render "2 / 3" while it syncs, then "3 / 3"
 * when it finishes. A SEPARATE store from `isSyncing` above, so the
 * transactions-list progress bar can render `completed / total` without the
 * pull-to-refresh spinner reacting to it. The published value is DERIVED by the
 * progress SESSION below, which spans the whole fan-out — the Monobank `runSync`
 * plus any concurrent crypto `runBalanceSync`, each contributing its syncable set
 * (see the session for the syncable predicate and the no-op guard). Direct
 * `setSyncProgress` remains the low-level primitive the session and tests use.
 */
type SyncProgress = { completed: number; total: number };

let progress: SyncProgress = { completed: 0, total: 0 };
const progressListeners = new Set<Listener>();

/**
 * Replace the progress snapshot; notifies subscribers only on an actual change.
 * The stored object is replaced ONLY when a value differs, so `getProgressSnapshot`
 * returns a STABLE reference between changes — `useSyncExternalStore` would loop
 * forever on a fresh object every read.
 */
export const setSyncProgress = (next: SyncProgress): void => {
  if (progress.completed === next.completed && progress.total === next.total) {
    return;
  }
  progress = next;
  for (const listener of progressListeners) {
    listener();
  }
};

/** Register a progress change listener; the returned function unsubscribes it. */
export const subscribeProgress = (listener: Listener): (() => void) => {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
};

/** The current progress, read synchronously (the `useSyncExternalStore` snapshot). */
export const getProgressSnapshot = (): SyncProgress => progress;

/** The current sync progress (`{ completed, total }`), reactively tracked. */
export const useSyncProgress = (): SyncProgress =>
  useSyncExternalStore(subscribeProgress, getProgressSnapshot);

/**
 * Determinate-progress SESSION coordination. The determinate bar now spans a
 * whole sync RUN that may fan out across several concurrent sync paths — the
 * Monobank `runSync` plus one `runBalanceSync` per connected crypto account (see
 * `useSyncAll`). Each path brackets its contribution with `beginProgressSession()`
 * and `endProgressSession()`; the FIRST begin lights `isSyncing` and resets the
 * accumulators, the LAST end clears both. A plain per-run reset/clear raced when
 * two runs overlapped — one path wiped another's start, or cleared the bar while
 * another path was still running — so the bracket is REFERENCE COUNTED.
 *
 * Between the brackets a path calls `registerSyncableHoldings(total, syncable)`
 * once — `total` is the whole-app active-holdings count (the same for every path,
 * taken as a max so a race cannot shrink it) and `syncable` is the number of THIS
 * path's holdings being refreshed this run — then `commitSyncableHoldings(n)` as
 * each of its holdings' balances/statements commit.
 *
 * The published `{ completed, total }` is derived: `completed` STARTS at the
 * non-syncing baseline `total - syncable` (every manual holding, every
 * balance-diff-skipped card, every unchanged jar) and rises by one per committed
 * syncable holding, ending at `total`. When nothing syncable is registered
 * (`syncable === 0`) the published value stays `{ 0, 0 }`, so the bar never
 * flashes a full "N / N" for a run that refreshes nothing syncable (the round-5
 * no-op guard, now spanning the whole fan-out). `isSyncing` rides this session,
 * so a crypto-only fan-out (no Monobank run) still lights the whole-run indicator.
 */
let sessionDepth = 0;
let sessionTotal = 0;
let sessionSyncable = 0;
let sessionCommitted = 0;

const resetSessionAccumulators = (): void => {
  sessionTotal = 0;
  sessionSyncable = 0;
  sessionCommitted = 0;
};

/** Recompute and publish the derived progress from the session accumulators. */
const publishSessionProgress = (): void => {
  if (sessionSyncable <= 0 || sessionTotal <= 0) {
    setSyncProgress({ completed: 0, total: 0 });
    return;
  }
  const baseline = sessionTotal - sessionSyncable;
  const completed = Math.min(sessionTotal, baseline + sessionCommitted);
  setSyncProgress({ completed, total: sessionTotal });
};

/** Enter one contributor to the shared progress session. */
export const beginProgressSession = (): void => {
  if (sessionDepth === 0) {
    resetSessionAccumulators();
    setSyncing(true);
  }
  sessionDepth += 1;
  publishSessionProgress();
};

/**
 * Register this contributor's syncable-holding numbers. Call once per path,
 * before it reports any completion. `total` is taken as a max across paths;
 * `syncable` accumulates (each path adds its own set).
 */
export const registerSyncableHoldings = (total: number, syncable: number): void => {
  sessionTotal = Math.max(sessionTotal, total);
  sessionSyncable += Math.max(0, syncable);
  publishSessionProgress();
};

/** Report that `count` of this run's syncable holdings have committed. */
export const commitSyncableHoldings = (count = 1): void => {
  sessionCommitted += count;
  publishSessionProgress();
};

/** Leave one contributor. The LAST end clears `isSyncing` and the progress. */
export const endProgressSession = (): void => {
  if (sessionDepth === 0) {
    return;
  }
  sessionDepth -= 1;
  if (sessionDepth === 0) {
    resetSessionAccumulators();
    setSyncProgress({ completed: 0, total: 0 });
    setSyncing(false);
    return;
  }
  publishSessionProgress();
};

/**
 * The FAST-PHASE-DONE signal: `true` from the instant a run's client-info fetch
 * and balance upsert commit (`upsertAllHoldings` in `sync.ts`) until the run
 * settles. It marks the "balances have landed" moment, LONG before the per-card
 * statement loop finishes.
 *
 * The pull-to-refresh spinner ends on THIS signal, not on the whole run: the
 * native `RefreshControl` was previously bound to the whole-run `isSyncing`
 * flag, which fights iOS across navigation/detach/scroll (the spinner froze or
 * vanished). Decoupling the spinner from the whole run — ending it when the
 * fast phase resolves — leaves the determinate progress bar (`useSyncProgress`)
 * as the whole-run indicator.
 *
 * A SEPARATE store from `isSyncing` and `progress`, so the pull path can
 * observe "balances committed" without either the spinner reacting to progress
 * or the progress bar reacting to the pull. It is a plain imperative
 * signal (no React hook): the pull path reads it inside an event handler, not
 * during render.
 */
let fastPhaseDone = false;
const fastPhaseListeners = new Set<Listener>();

/** Flip the fast-phase-done flag; notifies subscribers only on an actual change. */
export const setFastPhaseDone = (next: boolean): void => {
  if (fastPhaseDone === next) {
    return;
  }
  fastPhaseDone = next;
  for (const listener of fastPhaseListeners) {
    listener();
  }
};

/** The current fast-phase-done flag, read synchronously. */
export const isFastPhaseDone = (): boolean => fastPhaseDone;

/** Register a fast-phase-done change listener; the returned function unsubscribes it. */
export const subscribeFastPhase = (listener: Listener): (() => void) => {
  fastPhaseListeners.add(listener);
  return () => {
    fastPhaseListeners.delete(listener);
  };
};
