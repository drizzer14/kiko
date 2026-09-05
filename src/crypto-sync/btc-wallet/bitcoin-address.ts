// Mainnet address formats only. Legacy P2PKH / P2SH are base58 (`1…` / `3…`,
// 26–35 chars, alphabet without 0/O/I/l); bech32 / bech32m are `bc1…` in the
// lowercase bech32 alphabet (no 1/b/i/o). This is a FORMAT check, not a
// checksum — enough to fail fast on an obvious typo before the explorer call,
// which is the spec's stated purpose. Testnet (`tb1…`, `m…`, `n…`, `2…`) is
// rejected on purpose: the explorer endpoint is mainnet.
const BASE58_ADDRESS = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BECH32_ADDRESS = /^bc1[ac-hj-np-z02-9]{11,71}$/;

export const isValidBitcoinAddress = (value: string): boolean =>
  BASE58_ADDRESS.test(value) || BECH32_ADDRESS.test(value);
