// Semgrep fixture (POSITIVE): kiko-no-device-idiom MUST report a finding on every pinned line
// below. Never "fix" this file — see kiko-architecture's "Pane navigation".

// React Native's own `Platform` type has no idiom field, so this local declaration stands in for it
// and keeps the fixture type-checking; the rule matches the name `Platform`.
declare const Platform: { isPad: boolean; constants: { interfaceIdiom: string } };

// EXPECT-FINDING
export const readsIsPad = Platform.isPad;

// EXPECT-FINDING
export const readsIdiom = Platform.constants.interfaceIdiom;

// EXPECT-FINDING
const { isPad } = Platform;

// EXPECT-FINDING
const { isPad: renamedIsPad } = Platform;

// EXPECT-FINDING
const {
  constants: { interfaceIdiom },
} = Platform;

// EXPECT-FINDING
const {
  constants: { interfaceIdiom: renamedIdiom },
} = Platform;

// EXPECT-FINDING
const { interfaceIdiom: constantsIdiom } = Platform.constants;

const platformConstants = Platform.constants;

// EXPECT-FINDING
export const readsThroughConstants = platformConstants.interfaceIdiom;

export { isPad, renamedIsPad, interfaceIdiom, renamedIdiom, constantsIdiom };
