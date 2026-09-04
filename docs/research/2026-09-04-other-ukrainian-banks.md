# Other Ukrainian banks — feasibility and architecture

Date: 2026-09-04 · Status: research (not implemented)

## Headline
Ukraine Open Banking went legally live 1 August 2025 (NBU Resolution
No. 80), with compliance due 1 January 2026 and a transitional period
into mid-2026. BUT every Open Banking API requires the CALLER to be an
**NBU-authorised TPP (AISP)** — a licensed legal entity with audits.
**A personal side-project cannot self-serve any of these APIs.**
Monobank's self-issued personal token is the anomaly that makes Kiko
possible; it is effectively the only self-serve personal bank API.

## Current sync architecture (the template)
All Monobank-only, in `src/monobank/`:
- `monobank.client.ts` — thin `fetch`, `X-Token` header, two calls.
- `sync.ts` — `runSync` with a `SyncDeps` interface that injects every
  network/clock/data seam; the domain-writing half is already
  provider-agnostic. Only `readToken`, `fetchClientInfo`,
  `fetchStatement` + mappers are Monobank-specific.
- `holdings.repo.ts` `upsertMonobank` matches on
  `json_extract(metadata,'$.monobankId')` — reused idempotent upsert.
- Coupling points: `accounts.institution` is free-text (ready);
  `transactions.source` is enum `['manual','monobank']` (must widen);
  metadata key `monobankId` (make generic `externalId`);
  `holdings.currency` enum is 4 codes (widen for non-UAH/USD/EUR fiat).

## Per-bank feasibility (Sep 2026)
| Bank | Self-serve personal API? | Verdict |
|---|---|---|
| Monobank | Yes (`X-Token`) | Already integrated; the only viable one. |
| PrivatBank | Business/FOP only; personal-card API dead | Not viable for personal cards. |
| PUMB | Open Banking API, but TPP-gated + 4 calls/day | Blocked on licensing. |
| Sense / A-Bank / Oschad | No personal API | None until they ship TPP-gated APIs. |
| Aggregator (Salt Edge) | They hold the license | Paid/contractual, not hobby-tier. |

## Proposed `BankProvider` abstraction
Introduce a `BankProvider` interface returning already-normalized
`ProviderHolding` / `ProviderTransaction`, with `capabilities`
(window, max items, rate interval) per provider. Monobank becomes one
implementation: `fetchHoldings` = client-info + mappers,
`fetchTransactions` = one statement window + mapper. A generic
`runSync({ providerId, targetAccountId })` keeps paging/dedup/lastSync;
a registry `Record<ProviderId, BankProvider>` makes adding a bank one
object. Needs a migration to widen `transactions.source` and rename the
metadata key. **Refactor effort M** (worth doing regardless of a 2nd bank).

## Recommendation
1. Do the `BankProvider` refactor now — clean, low-risk, removes
   Monobank naming from the generic pipeline.
2. There is **no viable second personal integration today**.
3. If forced, PrivatBank AutoClient for FOP/entrepreneur users is the
   only unblocked option — narrow value, **effort M**.
4. Re-evaluate mid-2026, or consume a licensed aggregator (Salt Edge).

## Risks
The TPP-authorisation wall (dominant, regulatory, rising in 2027);
PrivatBank personal API is dead; PUMB's 4-calls/day + 90-day consent;
schema migration touches the dedup index; MCC categories are
Monobank-specific; non-4-code fiat forces a currency change.

## References
- Monobank API: https://api.monobank.ua/docs/index.html
- NBU Open Banking: https://bank.gov.ua/en/payments/open-banking
- Open Banking launch (Asters): https://www.asterslaw.com/press_center/legal_alerts/open_banking_to_launch_in_ukraine_on_1_august_2025/
- PUMB Open API: https://www.pumb.ua/en/open_api
- Salt Edge Ukraine: https://blog.saltedge.com/open-banking-compliance-in-ukraine-salt-edge-cs/
