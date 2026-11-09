import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Sign a Binance or Bybit query string: the lowercase-hex HMAC-SHA256 of the query under
 * the API secret, which the Binance caller appends as `&signature=` (Bybit signs a longer
 * string and sends the hex in a header, `bybit.client.ts`). Pure JS via
 * `@noble/hashes` — React Native ships no WebCrypto and a native crypto pod is
 * out of scope for this milestone.
 */
export const signQuery = (secret: string, query: string): string =>
  bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(query)));
