import { useLayoutEffect, useSyncExternalStore } from 'react';
import { defaultDateRange, startOfLocalDay } from '@kiko/dates';

type CustomRange = { from: Date | null; to: Date | null };

type DefaultRange = ReturnType<typeof defaultDateRange>;

type DateRangeSelection = {
  dateFrom: Date | null;
  dateTo: Date | null;
  applyDateRange: (from: Date | null, to: Date | null) => void;
  clearDateRange: () => void;
};

type Snapshot = { customRange: CustomRange | null; defaultRange: DefaultRange | null };

type Listener = () => void;

const EMPTY_SNAPSHOT: Snapshot = { customRange: null, defaultRange: null };

// One range for the whole app: Home and Statistics always show the same pick
// and the same default, so a change in one must reach the other.
let snapshot: Snapshot = EMPTY_SNAPSHOT;
// The latest `now` any reader published; it only moves forward.
let clock: number | null = null;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const setSharedCustomRange = (next: CustomRange | null): void => {
  if (snapshot.customRange === next) {
    return;
  }

  snapshot = { customRange: next, defaultRange: snapshot.defaultRange };
  notify();
};

// Home publishes a newer `now` on every render, so a same-day value must keep
// the snapshot object and stay silent, or the re-render would loop. The first
// publish is silent too: it runs before the reader subscribes, and a changed
// snapshot would cost every first mount a second render for the same default.
const publishNow = (next: number): void => {
  if (clock !== null && next <= clock) {
    return;
  }

  const previous = clock;

  clock = next;

  if (previous === null || startOfLocalDay(previous) === startOfLocalDay(next)) {
    return;
  }

  snapshot = { customRange: snapshot.customRange, defaultRange: defaultDateRange(next) };
  notify();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    // With no reader mounted nothing keeps the pick or the clock alive, so the
    // next mount starts on the default range again. The reset waits one
    // microtask: React runs a commit's passive cleanups and the new tree's
    // passive mounts in one synchronous flush, so a same-commit swap of every
    // reader (a fold/unfold) has subscribers again by then and keeps the pick
    // and the clock. A plain `Promise` and never `queueMicrotask`, which jest's
    // fake timers replace, so the reset would not run and would leak into the
    // next test.
    if (listeners.size === 0) {
      // The callback only reads and writes module state, so it never rejects.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
      Promise.resolve().then(() => {
        if (listeners.size === 0) {
          snapshot = EMPTY_SNAPSHOT;
          clock = null;
        }
      });
    }
  };
};

const getSnapshot = (): Snapshot => snapshot;

/**
 * The date-range selection behind a `DateRangeField`, ONE shared selection for
 * every reader (Home and Statistics): one pick and one default for every
 * mounted reader, so a pick made in one shows in the other and Clear clears
 * both. `customRange` holds an explicit user pick; `null` means "show the
 * default (last-30-days) range". The default is shared too: it comes from the
 * latest `now` any reader published and moves only when that `now` reaches a
 * new calendar day. It is derived from `now` instead of being frozen once at
 * mount — a tab stays mounted after it is left, and a range stored at mount
 * would stop including today once a calendar day passes. A reader falls back
 * to its own `now` until a new day is published, and never shows a shared
 * default older than its own day. A user pick still stays exactly as given,
 * even one side left null (open-ended) via the date-range field. The pick and
 * the clock reset only when no reader is mounted after the commit, so the range
 * starts on the default at every launch while a fold/unfold that replaces both
 * panes keeps the pick. Known limit: a device clock set back by hand before any
 * day crossing can split the panes until Statistics re-focuses.
 */
export const useDateRangeSelection = (now: number): DateRangeSelection => {
  const shared = useSyncExternalStore(subscribe, getSnapshot);

  // A layout effect, never a write during render: the store would change under
  // the other reader mid-commit, and both panes must show the new day before
  // the next paint.
  useLayoutEffect(() => {
    publishNow(now);
  }, [now]);

  // A reader mounted after a day crossing must not paint the stale shared
  // default for one frame while the subscribed pane already shows the new day.
  const sharedDefault =
    shared.defaultRange !== null &&
    startOfLocalDay(shared.defaultRange.to.getTime()) >= startOfLocalDay(now)
      ? shared.defaultRange
      : defaultDateRange(now);
  const range = shared.customRange ?? sharedDefault;

  // The date-range modal commits both bounds at once on Apply; either may be
  // null when that side of the range is left open-ended.
  const applyDateRange = (from: Date | null, to: Date | null): void => {
    setSharedCustomRange({ from, to });
  };

  const clearDateRange = (): void => {
    setSharedCustomRange(null);
  };

  return {
    dateFrom: range.from,
    dateTo: range.to,
    applyDateRange,
    clearDateRange,
  };
};
