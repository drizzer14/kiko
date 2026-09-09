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
 * The DETERMINATE progress of the current run: how many of the cards that WILL
 * be fetched this run have finished importing (`completed`) out of the total
 * that will be fetched (`total`). A SEPARATE store from `isSyncing` above, so
 * the transactions-list progress bar can render `completed / total` without the
 * pull-to-refresh spinner (driven by `isSyncing`) reacting to it. `runSync`
 * resets it to `{ 0, 0 }` at the start and end of every run, publishes `total`
 * once the balance-diff skip has decided the non-skipped set, and increments
 * `completed` as each card's statements import.
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
