import type { BunqCrypto } from '../bunq.types';

import { nodeForgeCrypto } from './node-forge-crypto';

/**
 * The production `BunqCrypto` binding, selected here so `src/bunq/sync/sync.ts`
 * imports one stable name (`defaultBunqCrypto`) regardless of which concrete
 * implementation backs it. Bound to `node-forge` (pure-JS RSA, APPROVED by
 * the coordinator + user) — see `./node-forge-crypto.ts` for the RSA-2048
 * keygen / RSA-SHA256 body signing implementation, including the
 * CSPRNG-or-throw guard that keeps a weak PRNG off a bank-auth keypair. A
 * test injects its OWN mock `BunqCrypto` instead of using this default (see
 * `src/bunq/client/bunq.client.test.ts`, `src/bunq/sync/sync.test.ts`).
 */
export const defaultBunqCrypto: BunqCrypto = nodeForgeCrypto;
