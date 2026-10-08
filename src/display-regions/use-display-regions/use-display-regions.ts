import { useSyncExternalStore } from 'react';

import { type DisplayRegionsSnapshot, displayRegionsNative } from '../display-regions-native';

// Module-level, so React keeps one subscription for as long as the component is mounted instead of
// re-subscribing on every render.
const subscribe = (onStoreChange: () => void): (() => void) =>
  displayRegionsNative.subscribe(onStoreChange);

// `getSnapshot` returns the wrapper's cached object, which `useSyncExternalStore` requires to
// avoid a render loop and which keeps every render off the native main-thread hop.
export const useDisplayRegions = (): DisplayRegionsSnapshot =>
  useSyncExternalStore(subscribe, displayRegionsNative.getSnapshot);
