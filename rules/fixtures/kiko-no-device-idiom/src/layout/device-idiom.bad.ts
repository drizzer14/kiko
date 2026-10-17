// Semgrep fixture (POSITIVE): kiko-no-device-idiom MUST report a finding on every pinned line
// below. Never "fix" this file — see kiko-architecture's "Pane navigation".

// React Native's `Platform` type declares the idiom fields only on its iOS member, so a read off
// the whole `Platform` union does not type-check. These local declarations stand in for `Platform`,
// its namespace read, an `import { Platform as P }` alias and the native constants, and keep the
// fixture type-checking; the rule matches the words, not the types.
type IdiomPlatform = { isPad: boolean; constants: { interfaceIdiom: string } };
declare const Platform: IdiomPlatform;
declare const P: IdiomPlatform;
declare const RN: { Platform: IdiomPlatform };
declare const NativeModules: { PlatformConstants: { interfaceIdiom: string } };

// EXPECT-FINDING
export const readsIsPad = Platform.isPad;

// EXPECT-FINDING
export const readsIdiom = Platform.constants.interfaceIdiom;

// EXPECT-FINDING
export const optionalIsPad = Platform?.isPad;

// EXPECT-FINDING
export const optionalIdiom = Platform.constants?.interfaceIdiom;

// EXPECT-FINDING
export const bracketIsPad = Platform['isPad'];

// EXPECT-FINDING
export const { isPad } = Platform;

// EXPECT-FINDING
export const { isPad: renamedIsPad } = Platform;

// EXPECT-FINDING
export const { constants: { interfaceIdiom } } = Platform;

// EXPECT-FINDING
export const { interfaceIdiom: constantsIdiom } = Platform.constants;

// EXPECT-FINDING
export const namespaceIsPad = RN.Platform.isPad;

// EXPECT-FINDING
export const nativeModulesIdiom = NativeModules.PlatformConstants.interfaceIdiom;

// EXPECT-FINDING
export const aliasedIsPad = P.isPad;

const platformConstants = Platform.constants;

// EXPECT-FINDING
export const readsThroughConstants = platformConstants.interfaceIdiom;
