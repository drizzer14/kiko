import { useSyncExternalStore } from 'react';

/**
 * A tiny module-level store for the TRANSIENT "a Monobank sync is running" UI
 * signal. It is deliberately NOT a database row and NOT a live query: nothing
 * about a run-in-progress is persisted, and it must flip the instant `runSync`
 * acquires/releases its single-flight lock — long before any row is written.
 * `runSync` (sync.ts) drives it from the lock's acquire/settle points, so any
 * trigger (auto-sync on open, pull-to-refresh, the manual button) lights the
 * same signal; every subscribed indicator observes it through
 * `useSyncStatus()`.
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
 * (everything except the cards fetched this run) and rises by one as each fetched
 * card's statements import. So 3 holdings with 1 card to sync render "2 / 3"
 * while it syncs, then "3 / 3" when it finishes. A SEPARATE store from
 * `isSyncing` above, so the transactions-list progress bar can render
 * `completed / total` without the pull-to-refresh spinner (driven by `isSyncing`)
 * reacting to it. `runSync` resets it to `{ 0, 0 }` at the start and end of every
 * run; `runSyncInner` publishes the holdings total with the non-syncing baseline
 * once the balance-diff skip has decided the non-skipped set (and publishes
 * NOTHING when no card is fetched, so the bar never flashes full for a no-op
 * sync).
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
