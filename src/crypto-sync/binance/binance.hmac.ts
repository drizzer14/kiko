import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Sign a Binance query string: the lowercase-hex HMAC-SHA256 of the query under
 * the API secret, which the caller appends as `&signature=`. Pure JS via
 * `@noble/hashes` — React Native ships no WebCrypto and a native crypto pod is
 * out of scope for this milestone.
 */
export const signQuery = (secret: string, query: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(query)));
