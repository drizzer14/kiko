import { type CodegenTypes, type TurboModule, TurboModuleRegistry } from 'react-native';

// The codegen spec for the app's own `KikoReminders` TurboModule. Codegen reads
// this file by its `Native*` name, so it keeps that name and a single dot.
export interface Spec extends TurboModule {
  authorizationStatus(): Promise<string>;
  requestAuthorization(): Promise<boolean>;
  replaceRequests(
    requestsJson: string,
    keepSnoozeReminderIds: ReadonlyArray<string>,
  ): Promise<void>;
  registerCategories(snoozeTitle: string, hiddenPreviewsBodyPlaceholder: string): void;
  drainResponses(): Promise<string>;
  readonly onResponse: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('KikoReminders');
