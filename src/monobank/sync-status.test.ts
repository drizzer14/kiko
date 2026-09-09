import {
  beginProgressSession,
  commitSyncableHoldings,
  endProgressSession,
  getProgressSnapshot,
  getSnapshot,
  isFastPhaseDone,
  registerSyncableHoldings,
  setFastPhaseDone,
  setSyncing,
  setSyncProgress,
  subscribe,
  subscribeFastPhase,
  subscribeProgress,
} from './sync-status';

describe('sync-status store', () => {
  // Module-level singleton state: reset it after each test so one test's flag
  // never leaks into the next.
  afterEach(() => {
    setSyncing(false);
    setSyncProgress({ completed: 0, total: 0 });
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

  // ITEM 2: the determinate sync-progress signal — how many of the cards that
  // WILL be fetched have imported so far. A separate store from `isSyncing`, so
  // the transactions-list progress bar can render `completed / total`.
  describe('progress', () => {
    it('starts at zero completed of zero total', () => {
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
    });

    it('reflects setSyncProgress in the snapshot', () => {
      setSyncProgress({ completed: 1, total: 3 });
      expect(getProgressSnapshot()).toEqual({ completed: 1, total: 3 });
    });

    it('returns a STABLE snapshot reference when the values are unchanged', () => {
      setSyncProgress({ completed: 2, total: 4 });
      const first = getProgressSnapshot();
      setSyncProgress({ completed: 2, total: 4 });

      // useSyncExternalStore loops forever if getSnapshot returns a fresh object
      // on every read; an unchanged set must keep the same reference.
      expect(getProgressSnapshot()).toBe(first);
    });

    it('notifies a progress listener only when the values change', () => {
      const listener = jest.fn();
      subscribeProgress(listener);

      setSyncProgress({ completed: 0, total: 0 }); // already the initial value
      expect(listener).not.toHaveBeenCalled();

      setSyncProgress({ completed: 1, total: 2 });
      setSyncProgress({ completed: 1, total: 2 }); // unchanged — no second notify
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('is independent of the isSyncing flag', () => {
      const progressListener = jest.fn();
      subscribeProgress(progressListener);

      setSyncing(true);

      // Flipping isSyncing must not notify a progress subscriber.
      expect(progressListener).not.toHaveBeenCalled();
    });
  });

  // The determinate bar now spans a whole sync RUN that fans out across several
  // concurrent sync paths — the Monobank `runSync` plus one `runBalanceSync` per
  // connected crypto account (see `useSyncAll`). Each path brackets its work with
  // `beginProgressSession()` / `endProgressSession()`; the FIRST begin lights
  // `isSyncing` and resets the accumulators, the LAST end clears both. Between the
  // brackets a path calls `registerSyncableHoldings(total, syncable)` once, then
  // `commitSyncableHoldings(n)` as each of its holdings commits. `completed`
  // starts at the non-syncing baseline `total - syncable` and rises to `total`.
  describe('progress session (fan-out coordination)', () => {
    it('lights isSyncing on the first begin and clears it plus the progress on the last end', () => {
      beginProgressSession();
      expect(getSnapshot()).toBe(true);
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });

      endProgressSession();
      expect(getSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
    });

    it('publishes the non-syncing baseline for one contributor and rises to full as it commits', () => {
      beginProgressSession();
      registerSyncableHoldings(3, 1);
      // Baseline = 3 total - 1 syncable = 2, the user's "2 / 3" example.
      expect(getProgressSnapshot()).toEqual({ completed: 2, total: 3 });

      commitSyncableHoldings();
      expect(getProgressSnapshot()).toEqual({ completed: 3, total: 3 });

      endProgressSession();
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
    });

    it('publishes nothing when a session registers no syncable holding (no-op guard)', () => {
      const listener = jest.fn();
      subscribeProgress(listener);

      beginProgressSession();
      registerSyncableHoldings(3, 0);
      commitSyncableHoldings(0);
      endProgressSession();

      // The bar never flashes a full "N / N" for a run that refreshes nothing.
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
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

    it('sums the syncable set across two contributors and ends at full (a mixed Monobank + crypto run)', () => {
      // The fan-out shape: a Monobank path (2 syncable cards) and a crypto path
      // (3 syncable holdings) over a 5-holding app (0 manual). Both paths report
      // the same whole-app total; it is taken as a max so a race cannot shrink it.
      beginProgressSession(); // Monobank path begins
      beginProgressSession(); // crypto path begins

      registerSyncableHoldings(5, 2); // Monobank registers 2 syncable cards
      // Crypto's 3 holdings still sit in the baseline until crypto registers.
      expect(getProgressSnapshot()).toEqual({ completed: 3, total: 5 });

      registerSyncableHoldings(5, 3); // crypto registers 3 syncable holdings
      // Baseline is now 0: every one of the 5 holdings is syncable.
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 5 });

      commitSyncableHoldings(3); // crypto commits its 3 holdings
      expect(getProgressSnapshot()).toEqual({ completed: 3, total: 5 });

      endProgressSession(); // crypto path ends — Monobank still running
      expect(getSnapshot()).toBe(true);
      expect(getProgressSnapshot()).toEqual({ completed: 3, total: 5 });

      commitSyncableHoldings(); // Monobank commits card 1
      commitSyncableHoldings(); // Monobank commits card 2
      expect(getProgressSnapshot()).toEqual({ completed: 5, total: 5 });

      endProgressSession(); // Monobank path ends — last contributor
      expect(getSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
    });

    it('never shows a negative completed or a fraction over 1 when summed syncable exceeds the counted total', () => {
      // A crypto first-connect (or a racy Monobank + crypto overlap): each path
      // reads the whole-app count BEFORE this run's new holdings exist, so the
      // counted total (a MAX across paths) is smaller than the summed syncable
      // set (a SUM). The shown total must floor at the syncable count and
      // `completed` must never go negative — otherwise the label reads "-2 / 3".
      beginProgressSession(); // Monobank path
      beginProgressSession(); // crypto path
      registerSyncableHoldings(3, 2); // Monobank: 2 syncable, saw 3 holdings
      registerSyncableHoldings(3, 3); // crypto first-connect: 3 NEW holdings, still saw 3

      const snap = getProgressSnapshot();
      expect(snap.total).toBe(5); // floored at the summed syncable count, not 3
      expect(snap.completed).toBe(0); // baseline 5 - 5, never negative
      expect(snap.completed).toBeGreaterThanOrEqual(0);
      expect(snap.completed).toBeLessThanOrEqual(snap.total);

      commitSyncableHoldings(5);
      expect(getProgressSnapshot()).toEqual({ completed: 5, total: 5 });

      endProgressSession();
      endProgressSession();
    });

    it('clamps completed to the total when a contributor over-commits', () => {
      beginProgressSession();
      registerSyncableHoldings(3, 1);
      commitSyncableHoldings(5); // more commits than syncable holdings

      expect(getProgressSnapshot()).toEqual({ completed: 3, total: 3 });
      endProgressSession();
    });

    it('ignores an unbalanced end with no active session', () => {
      endProgressSession();
      expect(getSnapshot()).toBe(false);
      expect(getProgressSnapshot()).toEqual({ completed: 0, total: 0 });
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
      setSyncProgress({ completed: 1, total: 2 });

      // Neither the isSyncing flag nor the progress signal notifies a
      // fast-phase subscriber.
      expect(fastPhaseListener).not.toHaveBeenCalled();
    });
  });
});
