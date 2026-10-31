import { type CodegenTypes, type TurboModule, TurboModuleRegistry } from 'react-native';

// The codegen spec for the app's own `DisplayRegions` TurboModule. Codegen reads
// this file by its `Native*` name, so it keeps that name and a single dot.
// `getSnapshot` returns the JSON of a `DisplayRegionsSnapshot`, and `onChange`
// emits the same JSON, so JS parses one shape for both.
export interface Spec extends TurboModule {
  getSnapshot(): string;
  requestRefresh(): void;
  readonly onChange: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DisplayRegions');
