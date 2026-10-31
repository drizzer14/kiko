import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// The options a screen shown as a default set on itself, by the key it is shown under. React
// Navigation describes such a screen with static options and keeps nothing for its `setOptions`,
// so the pane stack view holds them and lays them over the static ones.
export type StandInOptions = Record<string, NativeStackNavigationOptions>;

const holds = (current: Record<string, unknown>, options: Record<string, unknown>): boolean =>
  Object.entries(options).every(
    ([name, value]) => name in current && Object.is(current[name], value),
  );

/**
 * Merges `options` into the ones the default under `key` has set. The same object comes back when
 * nothing changes: a screen that sets what it has set already must not render the view again, or
 * its effect would loop.
 */
export const withStandInOptions = (
  all: StandInOptions,
  key: string,
  options: NativeStackNavigationOptions,
): StandInOptions => {
  const current = all[key] ?? {};

  return holds(current, options) ? all : { ...all, [key]: { ...current, ...options } };
};

/**
 * Keeps the options of the defaults that are shown. A default that comes back after a page took
 * its place, or after a fold, is a new screen and starts from its own options. The same object
 * comes back when nothing is dropped.
 */
export const keepStandInOptions = (all: StandInOptions, shownKeys: string[]): StandInOptions => {
  const kept = Object.entries(all).filter(([key]) => shownKeys.includes(key));

  return kept.length === Object.keys(all).length ? all : Object.fromEntries(kept);
};
