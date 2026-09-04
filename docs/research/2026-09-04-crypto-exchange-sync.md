# Crypto exchange / wallet sync — research

Date: 2026-09-04 · Status: research (not implemented)

## The gate: the currency model
`holdings.currency` is a closed enum `BTC | USD | EUR | UAH`; the same
4-code enum appears on `currency_rates`, `currency.ts`
(`currencyScale`, BTC=8), and `Money`. A Binance/Kraken account holds
arbitrary assets (ETH, USDT, SOL…), so:
- **BTC-only exchange sync fits today with ZERO schema change.**
- **Multi-asset needs an L-sized currency-model generalization** (open
  the enum into an asset registry: code + scale + symbol + coingecko id,
  widen the columns, add `fetchCryptoPrices(ids[])`). Do it as its own
  milestone; do not bury it inside a Binance PR.

## Template: the Monobank module
Mirror `token.ts` (Keychain), `monobank.client.ts` (thin fetch +
`guard`), `sync.ts` (injected `SyncDeps`), `holdings.repo.ts`
`upsertMonobank` (match on `json_extract(metadata,...)`). KEY
DIFFERENCE: exchanges give a **balance snapshot**, not a statement — so
crypto sync writes `balanceMinorUnits` directly (like the jar path),
simpler than Monobank; no transaction import.

## Binance read-only
- Create an API key with **only "Enable Reading"** (no trade/withdraw).
- Auth: `X-MBX-APIKEY` header + HMAC-SHA256 signature over the query
  (RN needs a pure-JS HMAC to avoid another native pod); `timestamp` +
  `recvWindow`.
- Balance: `GET /api/v3/account` → `balances[]` of `{asset,free,locked}`
  decimal strings (spot only). Filter non-zero.
- IP allowlist is impractical on mobile (rotating egress IP) → use an
  unrestricted read-only key; read-only permission is the real guardrail.
- Store `{apiKey, secret}` as one Keychain value with
  `BIOMETRY_CURRENT_SET` + `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Never in
  SQLite/logs. A read-only secret cannot move funds — worst case is
  portfolio-visibility exposure.

## Other exchanges (later)
Binance / OKX / Bybit = HMAC-SHA256 (OKX adds a passphrase); Kraken =
HMAC-SHA512 + nonce; Coinbase = ECDSA/ES256 (the odd one out). Simplest
read-only key access: Binance, then Kraken/Bybit.

## On-chain wallets (no secret)
User pastes a PUBLIC address; the app reads a balance — nothing to leak.
BTC via Blockstream/Blockchair (satoshis → a `BTC` holding at scale 8,
zero currency change). EVM via `eth_getBalance` (native) or a portfolio
API (needs a provider key you hold). Tradeoff: address discovery / xpub
is the hard part; one address ≠ one wallet.

## Mapping → holdings → valuation
One holding per asset under the connected `crypto` account,
`type:'crypto_asset'`, `currency=asset`,
`balanceMinorUnits = Money.fromMajor(currency, amount).minorUnits`,
`metadata = { binanceAsset }` / `{ chain, address }`. Clone
`upsertMonobank` → `upsertExchange`. Valuation reuses the CoinGecko rate
path — it "just works" once the rate table has the asset's pairs (BTC
today; other coins need the currency generalization).

## Provider abstraction
A `BalanceProvider { id, kind:'exchange'|'wallet', fetchBalances(deps) }`
with injected deps; a generic `runBalanceSync(provider,{targetAccountId})`;
credentials keyed `service: 'pff.<provider>.credentials'` as a JSON
struct with biometric access-control.

## Recommended sequence
1. Provider abstraction + **BTC public-address wallet** (no secret;
   lowest risk). **S–M.**
2. **Binance read-only, BTC-only.** **M.**
3. Currency-model generalization + multi-coin CoinGecko pricing. **L.**
4. Multi-asset Binance, then Kraken/Bybit. **M each.**
5. OKX (passphrase) / Coinbase (ECDSA) as distinct signer variants.

## Risks
Currency-enum expansion is invasive (main risk — ship BTC-only first);
secret-on-device (read-only key + biometric Keychain); mobile IP
allowlist reality; balance snapshot ≠ ledger (no historical net worth
from exchanges); Binance clock-skew rejects signed requests;
`transactions.source`/`institution` enums must gain new values.

## References
- Binance signing: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security
- Binance account: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
- Kraken auth: https://docs.kraken.com/api/docs/guides/spot-rest-auth/
- OKX v5: https://www.okx.com/docs-v5/en/
- CoinGecko simple price: https://docs.coingecko.com/reference/simple-price
- BTC address (Esplora): https://github.com/Blockstream/esplora/blob/master/API.md
- eth_getBalance: https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getbalance
