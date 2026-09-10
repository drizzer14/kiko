import {
  beginProgressSession,
  commitHolding,
  commitWork,
  endProgressSession,
  getProgressSnapshot,
  getSnapshot,
  isFastPhaseDone,
  registerWork,
  setFastPhaseDone,
  setSyncing,
  setSyncProgress,
  subscribe,
  subscribeFastPhase,
  subscribeProgress,
} from './sync-status';

/** The reset/no-op progress snapshot: no work, no holdings. */
const ZERO = { completed: 0, total: 0, workCompleted: 0, workTotal: 0 };

describe('sync-status store', () => {
  // Module-level singleton state: reset it after each test so one test's flag
  // never leaks into the next.
  afterEach(() => {
    setSyncing(false);
    setSyncProgress(ZERO);
    setFastPhaseDone(false);
  });

  it('starts not syncing', () => {
    expect(getSnapshot()).toBe(false);
  });

  it('reflects setSyncing in the snapshot', () => {
    setSyncing(true);
    expect(getSnapshot()).toBe(true);

    setSyncing(false);
    expect(getSnapshot()).toBe(false);
  });

  it('notifies a subscribed listener when the flag changes', () => {
    const listener = jest.fn();
    subscribe(listener);

    setSyncing(true);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the value is unchanged (idempotent set)', () => {
    const listener = jest.fn();
    subscribe(listener);

    setSyncing(false); // already false
    expect(listener).not.toHaveBeenCalled();

    setSyncing(true);
    setSyncing(true); // still true — no second notification
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);

    unsubscribe();
    setSyncing(true);

    expect(listener).not.toHaveBeenCalled();
  });

  // ITEM 2: the determinate sync-progress signal. It carries TWO quantities: the
  // WORK units that drive the bar FILL (a heavy card weighs more than a light
  // crypto fetch) and a HOLDINGS count that drives the "N/M" label. A separate
  // store from `isSyncing`, so the transactions-list progress bar can render it
  // without the pull-to-refresh spinner reacting.
  describe('progress', () => {
    it('starts at zero work and zero holdings', () => {
      expect(getProgressSnapshot()).toEqual(ZERO);
    });

    it('reflects setSyncProgress in the snapshot', () => {
      setSyncProgress({ completed: 1, total: 3, workCompleted: 2, workTotal: 8 });
      expect(getProgressSnapshot()).toEqual({
        completed: 1,
        total: 3,
        workCompleted: 2,
        workTotal: 8,
      });
    });

    it('returns a STABLE snapshot reference when the values are unchanged', () => {
      setSyncProgress({ completed: 2, total: 4, workCompleted: 2, workTotal: 4 });
      const first = getProgressSnapshot();
      setSyncProgress({ completed: 2, total: 4, workCompleted: 2, workTotal: 4 });

      // useSyncExternalStore loops forever if getSnapshot returns a fresh object
      // on every read; an unchanged set must keep the same reference.
      expect(getProgressSnapshot()).toBe(first);
    });

    it('notifies a progress listener only when the values change', () => {
      const listener = jest.fn();
      subscribeProgress(listener);

      setSyncProgress(ZERO); // already the initial value
      expect(listener).not.toHaveBeenCalled();

      setSyncProgress({ completed: 1, total: 2, workCompleted: 1, workTotal: 2 });
      setSyncProgress({ completed: 1, total: 2, workCompleted: 1, workTotal: 2 }); // unchanged
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies when only the work advances but the holdings count is unchanged', () => {
      const listener = jest.fn();
      subscribeProgress(listener);

      setSyncProgress({ completed: 0, total: 1, workCompleted: 1, workTotal: 10 });
      setSyncProgress({ completed: 0, total: 1, workCompleted: 2, workTotal: 10 });

      // A heavy card's page fetch advances work without completing the holding —
      // that must still notify so the bar creeps.
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('is independent of the isSyncing flag', () => {
      const progressListener = jest.fn();
      subscribeProgress(progressListener);

      setSyncing(true);

      // Flipping isSyncing must not notify a progress subscriber.
      expect(progressListener).not.toHaveBeenCalled();
    });
  });

  // The determinate bar spans a whole sync RUN that fans out across several
  // concurrent sync paths — the Monobank `runSync` plus one `runBalanceSync` per
  // connected crypto account (see `useSyncAll`). Each path brackets its work with
  // `beginProgressSession()` / `endProgressSession()`; the FIRST begin lights
  // `isSyncing` and resets the accumulators, the LAST end clears both. Between the
  // brackets a path calls `registerWork(holdings, work)` once per unit, then
  // `commitWork(units)` as it fetches and `commitHolding(count)` as each holding
  // finishes. The bar is WEIGHTED BY WORK: `workTotal` is the sum of every syncing
  // holding's work units, and `workCompleted` rises as work is DONE, with NO
  // pre-filled baseline.
  describe('progress session (fan-out coordination)', () => {
    it('lights isSyncing on the first begin and clears it plus the progress on the last end', () => {
      beginProgressSession();
      expect(getSnapshot()).toBe(true);
      expect(getProgressSnapshot()).toEqual(ZERO);

      endProgressSession();
      expect(getSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual(ZERO);
    });

    it('weights the total by WORK units, not by holding count', () => {
      beginProgressSession();
      registerWork(1, 10); // a heavy card: 1 holding, 10 statement windows
      registerWork(1, 1); // a light crypto holding: 1 holding, 1 balance fetch

      // total counts holdings (2); workTotal weights the heavy card at 10 of 11.
      expect(getProgressSnapshot()).toEqual({
        completed: 0,
        total: 2,
        workCompleted: 0,
        workTotal: 11,
      });
      endProgressSession();
    });

    it('advances the fill by work while the holding label lags, so a heavy card dominates', () => {
      beginProgressSession();
      registerWork(1, 10); // heavy card
      registerWork(1, 1); // light holding

      commitWork(1); // the light holding's single unit
      commitHolding(1); // and it is done

      // 1 of 2 holdings is done, but the bar is only 1/11 full — the heavy card,
      // still unfetched, holds most of the work. This is the whole point: no
      // pre-filled baseline, the fill tracks real fetch progress.
      expect(getProgressSnapshot()).toEqual({
        completed: 1,
        total: 2,
        workCompleted: 1,
        workTotal: 11,
      });
      endProgressSession();
    });

    it('publishes nothing when a session registers no work (no-op guard)', () => {
      const listener = jest.fn();
      subscribeProgress(listener);

      beginProgressSession();
      registerWork(0, 0);
      commitWork(0);
      endProgressSession();

      // The bar never appears for a run that fetches nothing.
      expect(getProgressSnapshot()).toEqual(ZERO);
      expect(listener).not.toHaveBeenCalled();
    });

    it('keeps isSyncing lit until the LAST contributor ends (reference counted)', () => {
      beginProgressSession();
      beginProgressSession();
      expect(getSnapshot()).toBe(true);

      endProgressSession();
      // One contributor still running — the signal stays lit.
      expect(getSnapshot()).toBe(true);

      endProgressSession();
      expect(getSnapshot()).toBe(false);
    });

    it('sums the work across two contributors and ends full (a mixed Monobank + crypto run)', () => {
      // The fan-out shape: a Monobank path (one 3-window card) and a crypto path
      // (3 balance fetches). Work is SUMMED across paths; the bar reaches full
      // only when all 6 units are done.
      beginProgressSession(); // Monobank path begins
      beginProgressSession(); // crypto path begins

      registerWork(1, 3); // Monobank: one card, 3 statement windows
      registerWork(3, 3); // crypto: 3 holdings, 1 unit each
      expect(getProgressSnapshot()).toEqual({
        completed: 0,
        total: 4,
        workCompleted: 0,
        workTotal: 6,
      });

      commitWork(3); // crypto fetches its 3 balances
      commitHolding(3);
      expect(getProgressSnapshot()).toEqual({
        completed: 3,
        total: 4,
        workCompleted: 3,
        workTotal: 6,
      });

      endProgressSession(); // crypto path ends — Monobank still running
      expect(getSnapshot()).toBe(true);

      commitWork(3); // Monobank fetches its 3 windows
      commitHolding(1);
      expect(getProgressSnapshot()).toEqual({
        completed: 4,
        total: 4,
        workCompleted: 6,
        workTotal: 6,
      });

      endProgressSession(); // Monobank path ends — last contributor
      expect(getSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual(ZERO);
    });

    it('clamps workCompleted to workTotal and completed to total when a contributor over-commits', () => {
      beginProgressSession();
      registerWork(1, 2);
      commitWork(5); // more work than registered
      commitHolding(5); // more holdings than registered

      expect(getProgressSnapshot()).toEqual({
        completed: 1,
        total: 1,
        workCompleted: 2,
        workTotal: 2,
      });
      endProgressSession();
    });

    it('ignores an unbalanced end with no active session', () => {
      endProgressSession();
      expect(getSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual(ZERO);
    });
  });

  // The fast-phase-done signal marks the instant a run's client-info fetch +
  // balance upsert commit — the "balances have landed" moment. The pull-to-
  // refresh spinner ends on THIS signal, so the native spinner is decoupled
  // from the whole run (which finishes minutes later after the per-card
  // statement loop). A SEPARATE store from `isSyncing` and `progress`, consumed
  // by the pull path only, so an auto-sync-on-open (no pull) never reacts to it.
  describe('fast-phase-done', () => {
    it('starts not done', () => {
      expect(isFastPhaseDone()).toBe(false);
    });

    it('reflects setFastPhaseDone in the snapshot', () => {
      setFastPhaseDone(true);
      expect(isFastPhaseDone()).toBe(true);

      setFastPhaseDone(false);
      expect(isFastPhaseDone()).toBe(false);
    });

    it('notifies a subscribed listener when the flag changes', () => {
      const listener = jest.fn();
      subscribeFastPhase(listener);

      setFastPhaseDone(true);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not notify when the value is unchanged (idempotent set)', () => {
      const listener = jest.fn();
      subscribeFastPhase(listener);

      setFastPhaseDone(false); // already false
      expect(listener).not.toHaveBeenCalled();

      setFastPhaseDone(true);
      setFastPhaseDone(true); // still true — no second notification
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeFastPhase(listener);

      unsubscribe();
      setFastPhaseDone(true);

      expect(listener).not.toHaveBeenCalled();
    });

    it('is independent of the isSyncing and progress signals', () => {
      const fastPhaseListener = jest.fn();
      subscribeFastPhase(fastPhaseListener);

      setSyncing(true);
      setSyncProgress({ completed: 1, total: 2, workCompleted: 1, workTotal: 2 });

      // Neither the isSyncing flag nor the progress signal notifies a
      // fast-phase subscriber.
      expect(fastPhaseListener).not.toHaveBeenCalled();
    });
  });
});
