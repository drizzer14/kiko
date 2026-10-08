// Semgrep fixture (POSITIVE): Hermes has no working `TextDecoder`/
// `TextEncoder` — confirmed on device, `TextDecoder` silently produces
// unparseable output. `src/data-transfer/utf8` hand-rolls the equivalent
// with plain ECMAScript instead. `kiko-no-textdecoder-textencoder` MUST
// report a finding on each of the two pinned lines below. Never "fix" this
// file — use `utf8Encode`/`utf8Decode` (`src/data-transfer/utf8`) instead.

// EXPECT-FINDING
const encoded = new TextEncoder().encode('hello');

// EXPECT-FINDING
export const decoded = new TextDecoder().decode(encoded);
