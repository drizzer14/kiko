# Final Hardening Bug Hunt — `src/` Correctness Review

## Method

This is a whole-app logic and correctness pass at head `82b9145` (clean
tree). It was reconciled against
`docs/superpowers/specs/2026-09-06-bug-hunt-tasks.md` (T-1…T-43) and
`docs/security/2026-09-06-security-pass-findings.md`. The debugger read
the money, currency, holdings, interest, and tax value objects, the
Monobank and crypto sync pipelines, the repositories (atomic write
paths), the migrations, `useLiveQuery`, the rate and statistics builders,
and the gate and bootstrap chain. The codebase is well hardened.
Essentially every prior task (T-1 through T-43) that was sampled is fixed
in the current code. The debugger found two genuine, still-present
defects. Both are lower-severity.

## Findings (most severe first)

### BUG1 — Auto-sync and pull-to-refresh can run the same crypto balance sync concurrently

- **Claim:** `runBalanceSync` has no single-flight guard, so an app-open
  auto-sync and an overlapping pull-to-refresh can each start their own
  balance sync for the same crypto account. This double-inflates the
  shared progress session and fires redundant Binance requests.
- **Severity:** Medium (confidence: high on the code path; the visible
  symptom is progress-UI inflation and a possible spurious pull failure,
  not data corruption).
- **Where:**
  - `src/screens/use-auto-sync.ts:78` — a direct
    `Promise.allSettled(jobs.map(job => job.run()))` that bypasses the
    `inFlightSyncAll` lock, not `runSyncAllOnce`.
  - `src/screens/use-sync-all.ts:48-63` — `inFlightSyncAll` guards only
    the pull path.
  - `src/crypto-sync/sync.ts:105-155` — `runBalanceSync` calls
    `beginProgressSession()` and `registerWork(...)` with no lock.
  - `App.tsx:32` mounts `useAutoSync()` app-wide;
    `src/screens/home/home.screen.tsx:179` mounts `useSyncAll`.
- **Failure scenario:** Take a crypto-only user (Binance connected,
  `settings.lastSyncAt` is `null`, so `throttleElapsed` is always true).
  On cold launch, `useAutoSync` starts `runBalanceSync(binance)` (four
  sequential signed REST calls plus a paced deposit and withdraw history
  walk — seconds to tens of seconds). Before it settles, the user pulls
  to refresh, so `useSyncAll` starts a second `runBalanceSync(binance)`.
  Each enters the reference-counted progress session and calls
  `registerWork(n, n)`, so `workTotal` and `holdingsTotal` become `2n`:
  the bar shows "X / 2n holdings" and the fill misbehaves. This is the
  inflation the `inFlightSyncAll` doc comment
  (`use-sync-all.ts:37-47`) says it exists to prevent — the fix covered
  pull-versus-pull but not auto-sync-versus-pull. A secondary effect: two
  concurrent Binance runs double the request weight. A resulting
  weight-429 on the Spot fetch throws, and on the pull path that surfaces
  to the user as a spurious sync failure. Balances and transactions stay
  correct, because the upserts and `addManyDedup` are idempotent.
- **Proposed fix:** Route the `useAutoSync` fan-out through the same
  single-flight as pull (export or share `runSyncAllOnce`), or give
  `runBalanceSync` its own per-account or module-level in-flight join
  lock that mirrors `runSync`'s `inFlightSync`. Overlapping triggers then
  join one crypto run instead of starting a second.

### BUG2 — Recap-OFF deposit interest counts one extra day versus the recap-ON engine

- **Claim:** `depositAccruedMajor` (recap-OFF) accrues from the
  contribution date itself, while the statement-validated recap-ON engine
  `depositLedger` earns from the day after each tranche lands. The two
  engines disagree by one day of interest on the first accrual.
- **Severity:** Low (previously identified as T-29, still unfixed; a
  one-day over-count of simple interest).
- **Where:**
  - `src/holdings/interest.ts:342-358` (`depositAccruedMajor` uses
    `daysBetween(c.date, end)`).
  - Compare `src/holdings/interest.ts:260-263`
    (`earnFrom: dayAfter(c.date)`).
  - Current behavior is pinned by `src/holdings/interest.test.ts:293-297`
    (10,000 at 10% over a year → exactly 1000.00 = 365 days).
- **Failure scenario:** Take 10,000 at 10% held one full year. Recap-OFF
  gives 1000.00 (365 days). The equivalent recap-ON first period computes
  364 days. If both model the same bank convention, recap-OFF
  over-reports interest, and thus the deposit's net value and net worth,
  by one day's accrual.
- **Proposed fix:** Pick one convention — presumably `dayAfter`, to match
  the statement-validated recap-ON path — and route both engines through
  it. First confirm against a real recap-OFF bank statement which day the
  bank starts accruing on.

## Minor note (not ranked as a defect)

`retryAfterMs` in `src/monobank/monobank.client.ts:81-85`: a
`Retry-After: 0` header parses to a finite `0`, which collapses the 429
backoff to 0 ms for that retry (the intended fallback triggers only on a
missing or non-numeric header). It is bounded by
`MAX_RATE_LIMIT_RETRIES`, so it cannot loop unbounded — it is effectively
a server-directed immediate retry. Consider flooring the backoff at the
per-token interval.

## Verified clean / covered and found correct

- **Money value object and currency** (`src/currency/money.ts`,
  `src/currency/currency.ts`): integer-minor arithmetic,
  `Math.trunc`/`Math.round` factories, same-currency assertions, and BTC
  scale-8 are all correct. There is no float accumulation before
  rounding.
- **Conversion and net worth** (`src/rates/conversion.ts`,
  `src/rates/net-worth-view.ts`, `src/rates/currency-totals.ts`): the
  missing-rate guard (`canConvert`) drops unconvertible holdings from
  both the headline and the breakdown consistently (T-34 fixed);
  `buildRateTable` finite-checks parsed strings.
- **Rates refresh and providers** (`src/rates/rates-refresh.ts`,
  `src/rates/coingecko.ts`): the `Promise.allSettled` per-provider
  isolation and the CoinGecko body validation are both present (T-14
  fixed).
- **Interest, deposit, and bond engine** (`src/holdings/interest.ts`,
  `holding-value.ts`, `tax.ts`, `derived-entries.ts`): the `addMonths`
  month-end clamp, the DST-safe `daysBetween`, the coupon-date de-dup,
  the cumulative two-levy tax rounding, and the bond valued at
  cost-until-maturity are all correct (T-2 fixed). Only the
  recap-OFF/recap-ON day convention (BUG2) diverges.
- **Monobank sync** (`src/monobank/sync.ts`, `sync-status.ts`,
  `throttle.ts`, `monobank.client.ts`): the per-token single-flight join,
  the one shared 60 s gate, the crash-safe `syncedBalanceMinorUnits`
  marker, the changed-first ordering, the partial-failure isolation, the
  cursor persisted as a queried ceiling (T-5/T-12/T-13/T-16/T-30 fixed),
  the 429 and timeout handling, and the guarded stale-holding close are
  all present.
- **Crypto / Binance** (`crypto-sync/sync.ts`, `run-crypto-sync.ts`,
  `binance/binance.provider.ts`, `binance/binance.transactions.ts`): the
  payload-shape validation, the non-finite rejection, the skip-vs-zero
  wallet rules, the UTC withdrawal-time parsing, and the idempotent
  history walk are all present (T-31 fixed). The concurrency gap is BUG1.
- **Repositories** (`transactions.repo.ts`, `holdings.repo.ts`,
  `accounts.repo.ts`): all balance mutations are read-modify-write inside
  one op-sqlite transaction; edit and delete compute deltas against the
  persisted amount; manual balance edits and opening balances write
  explaining ledger rows (T-7/T-18 fixed); disconnect keeps the sync keys
  so reconnect re-adopts rather than duplicating (T-3 fixed); the cascade
  deletes are FK-ordered; `addManyDedup` upsert refreshes only bank-owned
  columns and preserves the user category.
- **Migrations and bootstrap** (`db/run-migrations.ts`,
  `migrate-legacy-db.ts`, `migrations.gate.tsx`): the count-based applied
  gate (monotonic-clock-safe), the per-migration atomic apply, and the
  memoized single in-flight run are all present; the gate awaits
  `settingsRepo.ensure()` and `applyPersistedLanguage` before paint
  (T-1/T-25 fixed).
- **useLiveQuery** (`db/use-live-query.ts`): the generation-counter
  out-of-order guard, the unmount guard, and the content-keyed (not
  reference-keyed) subscription are all present. There is no stale-closure
  or infinite-resubscribe bug.
- **Statistics, series, and dates** (`statistics/*`,
  `dates/local-day.ts`, `dates/default-range.ts`, `buckets.ts`,
  `net-worth-series.ts`, `holding-value-at.ts`): the DST-safe
  `endOfLocalDay`, the range-scoped spending donut with full-ledger
  exclusion by id (T-20/T-32 fixed), the UTC-day rate lookups, and the
  greedy same-currency transfer pairing are all present.
- No empty catches, unguarded `JSON.parse`, non-null index assertions,
  SQL string interpolation, or logged secrets were found in `src/`.
- The removed net-worth widget means the widget-related security and
  performance items (S2/S3, T-24/T-27/T-43) are moot. The debugger
  confirmed there is no `src/widget/` in the current tree.
