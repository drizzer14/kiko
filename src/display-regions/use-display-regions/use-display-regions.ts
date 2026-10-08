import { useSyncExternalStore } from 'react';

import { type DisplayRegionsSnapshot, displayRegionsNative } from '../display-regions-native';

// Module-level, so React keeps one subscription for as long as the component is mounted instead of
// re-subscribing on every render.
const subscribe = (onStoreChange: () => void): (() => void) =>
  displayRegionsNative.subscribe(onStoreChange);

// `getSnapshot` returns the same object while the native JSON is unchanged, which
// `useSyncExternalStore` requires to avoid a render loop.
export const useDisplayRegions = (): DisplayRegionsSnapshot =>
  useSyncExternalStore(subscribe, displayRegionsNative.getSnapshot);
