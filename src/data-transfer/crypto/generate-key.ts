import { randomBytes } from '@noble/ciphers/utils.js';

/** 256 bits — the AES-256-GCM key size this feature always uses. */
export const EXPORT_KEY_BYTES = 32;

/**
 * A fresh random AES-256 key for one export. Requires `crypto.getRandomValues`
 * on the global object (`randomBytes`'s own contract, `@noble/ciphers/utils.js`)
 * — provided on-device by `react-native-get-random-values` (imported first in
 * `index.js`), and natively by Node under Jest, so this needs no mock in tests.
 */
export const generateExportKey = (): Uint8Array => randomBytes(EXPORT_KEY_BYTES);
