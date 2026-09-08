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
