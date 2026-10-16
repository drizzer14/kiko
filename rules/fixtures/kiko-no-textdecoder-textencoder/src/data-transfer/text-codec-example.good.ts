import { utf8Decode, utf8Encode } from '../../../../../src/data-transfer/utf8/utf8';

// Semgrep fixture (NEGATIVE): uses the hand-rolled `utf8Encode`/`utf8Decode`
// pair instead of `TextEncoder`/`TextDecoder`, which Hermes has no working
// implementation of. A comment merely NAMING TextEncoder/TextDecoder (like
// this one) must not match `kiko-no-textdecoder-textencoder`.
export const roundTrip = (text: string): string => utf8Decode(utf8Encode(text));
