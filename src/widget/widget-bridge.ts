import { NativeModules } from 'react-native';

import type { NetWorthSnapshot } from './net-worth-snapshot';

// The native module's contract. Optional on `NativeModules` so a build without
// the extension (or a Jest run) resolves to `undefined` and the wrapper no-ops
// rather than crashing the app.
type NativeWidgetBridge = {
  writeSnapshot: (json: string) => Promise<void>;
  clearSnapshot: () => Promise<void>;
  reloadWidget: () => void;
};

const native = (NativeModules as { WidgetBridge?: NativeWidgetBridge }).WidgetBridge;

// The typed JS boundary to the widget. `writeSnapshot` serializes the snapshot
// (the native side stores the raw JSON in the App Group container);
// `clearSnapshot` deletes that file again; `reloadWidget` asks WidgetKit to reload
// all timelines. All three degrade to a no-op when the native module is
// unavailable.
export const widgetBridge = {
  writeSnapshot: async (snapshot: NetWorthSnapshot): Promise<void> => {
    if (native === undefined) {
      return;
    }

    await native.writeSnapshot(JSON.stringify(snapshot));
  },
  // Removes the App Group snapshot entirely, so a locked device leaves no real
  // balances in the shared container. See docs/security/README.md (S2/S3).
  clearSnapshot: async (): Promise<void> => {
    if (native === undefined) {
      return;
    }

    await native.clearSnapshot();
  },
  reloadWidget: (): void => {
    if (native === undefined) {
      return;
    }

    native.reloadWidget();
  },
};
