import { useSyncExternalStore } from 'react';
import { toggleFilterValue } from '@kiko/design-system/toggle-filter-value';

type Snapshot = { accounts: Set<string>; categories: Set<string> };

type StatisticsFilterSelection = {
  selectedAccounts: Set<string>;
  selectedCategories: Set<string>;
  toggleAccount: (value: string) => void;
  toggleCategory: (value: string) => void;
};

type Listener = () => void;

// Never mutated: every toggle publishes fresh Sets, so sharing the empty ones is safe.
const EMPTY_SNAPSHOT: Snapshot = { accounts: new Set(), categories: new Set() };

// One pick for both Statistics screens (the tab and the Home companion), the way the date range
// is shared: a change in one must reach the other.
let snapshot: Snapshot = EMPTY_SNAPSHOT;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const toggleAccount = (value: string): void => {
  snapshot = { ...snapshot, accounts: toggleFilterValue(value)(snapshot.accounts) };
  notify();
};

const toggleCategory = (value: string): void => {
  snapshot = { ...snapshot, categories: toggleFilterValue(value)(snapshot.categories) };
  notify();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    // The reset waits one microtask, so a same-commit swap of every reader (a fold/unfold) has
    // subscribers again by then and keeps the pick. A plain `Promise` and never `queueMicrotask`,
    // which jest's fake timers replace, so the reset would not run and would leak into the next
    // test.
    if (listeners.size === 0) {
      // The callback only reads and writes module state, so it never rejects.
      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
      Promise.resolve().then(() => {
        if (listeners.size === 0) {
          snapshot = EMPTY_SNAPSHOT;
        }
      });
    }
  };
};

const getSnapshot = (): Snapshot => snapshot;

/**
 * The Statistics account and category filter selections, ONE shared selection for every mounted
 * Statistics screen: a pick made in the tab shows in the Home companion and the other way round.
 * An empty set means "all". The picks reset only when no reader is mounted after the commit, so
 * the filters start on "all" at every launch while a fold/unfold that replaces both panes keeps
 * them.
 */
export const useStatisticsFilterSelection = (): StatisticsFilterSelection => {
  const { accounts, categories } = useSyncExternalStore(subscribe, getSnapshot);

  return {
    selectedAccounts: accounts,
    selectedCategories: categories,
    toggleAccount,
    toggleCategory,
  };
};
