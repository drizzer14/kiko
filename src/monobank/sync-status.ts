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
 * The DETERMINATE progress of the current run. It carries TWO quantities:
 *
 * - `workCompleted` / `workTotal` — the WORK units that drive the bar FILL. A
 *   run is WEIGHTED BY REAL WORK: a Monobank card weighs its statement-window
 *   count (a large history occupies more of the bar), a changed jar or a crypto
 *   balance fetch weighs one unit, and a skipped card / unchanged jar / manual
 *   holding weighs nothing. `workCompleted` STARTS at 0 (no pre-filled baseline)
 *   and rises as work is DONE.
 * - `completed` / `total` — the HOLDINGS count that drives the "N/M" label:
 *   `total` is the number of holdings that do real work this run, `completed` is
 *   how many have finished. The label and the fill are decoupled on purpose (the
 *   file-copy pattern): "1 / 2 holdings" can sit at a 1/11 fill while a heavy
 *   card is still fetching.
 *
 * A SEPARATE store from `isSyncing` above, so the transactions-list progress bar
 * can render it without the pull-to-refresh spinner reacting. The published value
 * is DERIVED by the progress SESSION below, which spans the whole fan-out — the
 * Monobank `runSync` plus any concurrent crypto `runBalanceSync`, each
 * contributing its own work (see the session for the no-op guard). Direct
 * `setSyncProgress` remains the low-level primitive the session and tests use.
 */
type SyncProgress = {
  completed: number;
  total: number;
  workCompleted: number;
  workTotal: number;
};

let progress: SyncProgress = { completed: 0, total: 0, workCompleted: 0, workTotal: 0 };
const progressListeners = new Set<Listener>();

/**
 * Replace the progress snapshot; notifies subscribers only on an actual change.
 * The stored object is replaced ONLY when a value differs, so `getProgressSnapshot`
 * returns a STABLE reference between changes — `useSyncExternalStore` would loop
 * forever on a fresh object every read.
 */
export const setSyncProgress = (next: SyncProgress): void => {
  if (
    progress.completed === next.completed &&
    progress.total === next.total &&
    progress.workCompleted === next.workCompleted &&
    progress.workTotal === next.workTotal
  ) {
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
 * Determinate-progress SESSION coordination. The determinate bar spans a whole
 * sync RUN that may fan out across several concurrent sync paths — the Monobank
 * `runSync` plus one `runBalanceSync` per connected crypto account (see
 * `useSyncAll`). Each path brackets its contribution with `beginProgressSession()`
 * and `endProgressSession()`; the FIRST begin lights `isSyncing` and resets the
 * accumulators, the LAST end clears both. A plain per-run reset/clear raced when
 * two runs overlapped — one path wiped another's start, or cleared the bar while
 * another path was still running — so the bracket is REFERENCE COUNTED.
 *
 * Between the brackets a path calls `registerWork(holdings, work)` to add its
 * work up front, then `commitWork(units)` as it fetches and `commitHolding(count)`
 * as each holding finishes. The bar is WEIGHTED BY REAL WORK: `workTotal` is the
 * SUM of every syncing holding's work units across every path — a Monobank card's
 * statement-window count, one unit per changed jar or crypto balance fetch — and
 * `workCompleted` rises as work is DONE, starting at 0 with NO pre-filled
 * baseline. `holdingsTotal`/`holdingsCompleted` count holdings for the label only.
 *
 * When nothing does real work (`workTotal === 0`) the published value stays the
 * zero snapshot, so the bar never appears for a run that fetches nothing (the
 * no-op guard, spanning the whole fan-out). `isSyncing` rides this session, so a
 * crypto-only fan-out (no Monobank run) still lights the whole-run indicator.
 */
let sessionDepth = 0;
let workTotal = 0;
let workCompleted = 0;
let holdingsTotal = 0;
let holdingsCompleted = 0;

const ZERO_PROGRESS: SyncProgress = { completed: 0, total: 0, workCompleted: 0, workTotal: 0 };

const resetSessionAccumulators = (): void => {
  workTotal = 0;
  workCompleted = 0;
  holdingsTotal = 0;
  holdingsCompleted = 0;
};

/** Recompute and publish the derived progress from the session accumulators. */
const publishSessionProgress = (): void => {
  if (workTotal <= 0) {
    setSyncProgress(ZERO_PROGRESS);
    return;
  }
  // Clamp both numerators into their totals so a per-card page over-count (a
  // capped statement page beyond the up-front window estimate) or an over-commit
  // can never draw a fill above 1 nor a label above "N / N".
  setSyncProgress({
    completed: Math.min(holdingsTotal, Math.max(0, holdingsCompleted)),
    total: holdingsTotal,
    workCompleted: Math.min(workTotal, Math.max(0, workCompleted)),
    workTotal,
  });
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
 * Register this contributor's work up front. Both accumulate across paths:
 * `holdings` is the number of holdings this path will finish (the label
 * denominator), `work` is the total work units it will do (the fill denominator).
 */
export const registerWork = (holdings: number, work: number): void => {
  holdingsTotal += Math.max(0, holdings);
  workTotal += Math.max(0, work);
  publishSessionProgress();
};

/** Report that `units` of work have been DONE (a statement page, a balance fetch). */
export const commitWork = (units = 1): void => {
  workCompleted += units;
  publishSessionProgress();
};

/** Report that `count` syncing holdings have finished (advances the label). */
export const commitHolding = (count = 1): void => {
  holdingsCompleted += count;
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
    setSyncProgress(ZERO_PROGRESS);
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
