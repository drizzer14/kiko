import { useSyncExternalStore } from 'react';

import type { TablePeriod } from '../table-period';

type TablesPeriodSelection = {
  selectedPeriod: TablePeriod | undefined;
  selectPeriod: (period: TablePeriod | undefined) => void;
};

type Listener = () => void;

// The period lives for the app session and is never reset on unsubscribe: the Tables screen is
// popped on Back and mounted afresh on every open, and a route param goes with the route, so the
// pick has to outlive every reader. The module starts empty, so every launch opens on the default.
let selected: TablePeriod | undefined;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const selectPeriod = (period: TablePeriod | undefined): void => {
  selected = period;
  notify();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): TablePeriod | undefined => selected;

/**
 * The period the user last picked on the Tables screen, kept for the app session, even while no
 * Tables screen is mounted, so a screen opened after Back shows it again. `undefined` means no
 * pick, which the screen reads as the default. The screen reads a kept period that is not on offer
 * as the default too; the store holds what was picked and judges nothing.
 */
export const useTablesPeriodSelection = (): TablesPeriodSelection => ({
  selectedPeriod: useSyncExternalStore(subscribe, getSnapshot),
  selectPeriod,
});
