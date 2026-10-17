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
    // next mount starts on the default range again.
    if (listeners.size === 0) {
      snapshot = EMPTY_SNAPSHOT;
      clock = null;
    }
  };
};

const getSnapshot = (): Snapshot => snapshot;

/**
 * The date-range selection behind a `DateRangeField`, ONE shared selection for
 * every reader (Home and Statistics): a pick made in one shows in the other,
 * and Clear clears both. `customRange` holds an explicit user pick; `null`
 * means "show the default (last-30-days) range". The default is shared too: it
 * comes from the latest `now` any reader published and moves only when that
 * `now` reaches a new calendar day, so both screens never show different
 * defaults. It is derived from `now` instead of being frozen once at mount —
 * a tab stays mounted after it is left, and a range stored at mount would stop
 * including today once a calendar day passes. A reader falls back to its own
 * `now` until a new day is published. A user pick still stays exactly as
 * given, even one side left null (open-ended) via the date-range field. The
 * pick and the clock reset when the last reader unmounts, so the range starts
 * on the default at every launch.
 */
export const useDateRangeSelection = (now: number): DateRangeSelection => {
  const shared = useSyncExternalStore(subscribe, getSnapshot);

  // A layout effect, never a write during render: the store would change under
  // the other reader mid-commit, and both panes must show the new day before
  // the next paint.
  useLayoutEffect(() => {
    publishNow(now);
  }, [now]);

  const range = shared.customRange ?? shared.defaultRange ?? defaultDateRange(now);

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
