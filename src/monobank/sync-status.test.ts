import {
  getProgressSnapshot,
  getSnapshot,
  isFastPhaseDone,
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
