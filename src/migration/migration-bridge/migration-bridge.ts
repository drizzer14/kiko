import { NativeModules } from 'react-native';

// The native file primitives added to WidgetBridge for the one-time migration.
// Optional on NativeModules so a Jest run (or a build without the extension)
// resolves to undefined; unlike the widget wrapper, migration code must FAIL
// loudly rather than silently no-op, so every method throws when unavailable.
type NativeMigrationBridge = {
  sharedContainerPath: (appGroupID: string) => Promise<string | null>;
  copyFile: (fromPath: string, toPath: string) => Promise<void>;
  fileExists: (atPath: string) => Promise<boolean>;
  deleteFile: (atPath: string) => Promise<void>;
  readTextFile: (atPath: string) => Promise<string | null>;
};

const native = (NativeModules as { WidgetBridge?: NativeMigrationBridge }).WidgetBridge;

const require_ = (): NativeMigrationBridge => {
  if (native === undefined) {
    throw new Error(
      'WidgetBridge native module is unavailable: the one-time migration cannot run here.',
    );
  }

  return native;
};

export const migrationBridge = {
  sharedContainerPath: (appGroupID: string): Promise<string | null> =>
    require_().sharedContainerPath(appGroupID),
  copyFile: (fromPath: string, toPath: string): Promise<void> =>
    require_().copyFile(fromPath, toPath),
  fileExists: async (atPath: string): Promise<boolean> =>
    Boolean(await require_().fileExists(atPath)),
  deleteFile: (atPath: string): Promise<void> => require_().deleteFile(atPath),
  readTextFile: (atPath: string): Promise<string | null> => require_().readTextFile(atPath),
};
