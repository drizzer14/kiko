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

// One pick for both Statistics screens (the tab and the Home companion): a change in one must reach
// the other. It lives for the app session and is never reset on unsubscribe, so a pick survives a
// form opened over the companion; the module starts empty, so every launch starts on "all".
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
  };
};

const getSnapshot = (): Snapshot => snapshot;

/**
 * The Statistics account and category filter selections, ONE shared selection for every mounted
 * Statistics screen: a pick made in the tab shows in the Home companion and the other way round.
 * An empty set means "all". A pick is kept for the app session, even while no Statistics screen is
 * mounted; a fresh launch starts on "all" because the module starts empty.
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
