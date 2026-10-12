# Binance history (Pay, own-wallet transfers, Simple Earn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Binance movement that changes the Spot (`'BTC'`), Funding (`'BTC:funding'`) or Earn (`'BTC:earn'`) BTC holding becomes a transaction row on that holding. Convert is deferred (D7).

**Architecture:** One shared request gate and one `BinanceRunBudget` per Binance arm feed four walks in order (capital, Pay, Transfer, Earn). Each walk is its own file, its own watermark on the Spot holding's metadata, and its own `logOnFailure`. Movements between two tracked holdings are paired legs (`exchangeCounterpartHoldingId` + `exchangePairId`). A one-leg movement to an untracked wallet carries the new `transactions.untracked_counterpart` code (migration 0056). Labels are resolved at render time.

**Tech Stack:** React Native 0.87, op-sqlite + Drizzle, react-i18next, Jest/RNTL with `node:sqlite` (`@kiko/test-support/real-sqlite`), fnts, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-09-binance-pay-history-design.md` (rev 3, commit 7aa2aeaf, approved D1-D7). Read it with this plan; the matrix row ids (P1, T3, E8, ...) below refer to it.

**Track:** `binance-history`. Change sets are named "binance-history task N/7"; steps inside are "step N/M".

## Spec claims checked against the code (mismatches first)

1. **The newest Pay window would never commit.** Spec section 4: a Pay window commits only when its end is at or before `binanceHistoryCursor`. The capital walk writes `window.end = now` at ITS start, and the Pay walk's `now` is later, so the last Pay window is always past the cursor. The plan clamps the Pay walk's `endTime` to `min(now, capitalCursor)` (task 4/7). A null capital cursor means Pay does nothing that run (`complete: false`). SUPERSEDED (user ruling C1, 2026-10-10): the cap is removed with the overlap guard, the Pay end is `now`, and a null capital cursor no longer blocks Pay.
2. **P7 via `upsertExchangeMany` would zero a live holding.** `upsertByMetadataKey` (`src/holdings/repo/holdings.repo.ts:198`) writes `balanceMinorUnits: rest.balanceMinorUnits ?? 0` on a key match. If the holding appears between the walk's read and its write, the walk would overwrite a real balance with 0. The plan adds an insert-only `holdingsRepo.ensureExchangeHoldings` that never touches an existing row (task 2/7).
3. **The `uid` never reaches the walks.** `fetchAccount` runs inside `binanceProvider.fetchBalances`; `runBalanceSync` returns a `BalanceSyncResult` with no provider data. The plan has the Pay walk read `fetchAccount` itself once per run (cost `{ ip: 20 }`, counted under the Pay cap). A non-429 failure there gives `uid = null` (signal 2 absent), not a walk failure.
4. **20 transfer types, not 18.** The 18 in S4 are the UNTRACKED types. The walk also reads `MAIN_FUNDING` and `FUNDING_MAIN`, so a first walk is about 7 windows x 20 types = 140 calls (3 runs at cap 60).
5. **`addManyDedup` cannot write the markers.** Its input type `NewTransaction` (`transactions.repo.ts:63`) has no `exchangeCounterpartHoldingId`, `exchangePairId`, or (new) `untrackedCounterpart`. Task 3/7 widens it. These columns are NOT added to `BANK_OWNED_TRANSACTION_COLUMNS`, so a refresh never rewrites them (keys are deterministic, so they never change).
6. **The same-currency branch needs both currencies.** `transactionRowDescription` gets only `holdingNameById`. Task 3/7 adds a required `holdingCurrencyById: ReadonlyMap<string, string>` so `tsc` finds every caller: `home.screen.tsx:289`, `transaction-row.component.tsx` (+ `.props.d.ts`), `holding-detail.screen.tsx:970`, `transaction-form.screen.tsx:243,279`, `example-transaction.component.tsx:70`. This also relabels a manual same-currency Exchange leg to "Transfer to/from" (the spec's currency rule is general).
7. **Spending exclusion input is built in the screen.** `exchangeExcludedTransactionIds` reads rows mapped in `statistics.screen.tsx:759,787,812` and typed by `category-breakdown.ts:20-30`. All four places gain `untrackedCounterpart`.
8. **`logOnFailure` is not used today.** The arm uses `either` + `logFailure` (`run-crypto-sync.ts:18-25`). `logOnFailure(tag, task)` exists in `@kiko/diagnostics`; each walk gets its own call.
9. **Disconnect resets every walk key to `HISTORY_FLOOR_MS` (2017).** `withWalkOwnedMetadataResetToFloor` iterates `walkOwnedMetadataKeys`, so the new keys reset with no disconnect change. 2017 is below the Pay floor (18 months) and the Transfer floor (6 months), so each walk clamps its start to its own floor (pinned in tasks 4/7 and 5/7).
10. **A credential client must send `no-store`.** `scripts/checks/plist.sh:20` flags any file holding `'X-MBX-APIKEY'`. `binance.history-client.ts` must reuse the exported `signedRequestPage` from `binance.client.ts` and never build its own headers.
11. **Withdraw-budget constants are exported from `binance.transactions.ts`** (`WITHDRAW_CALLS_PER_RUN_FALLBACK`, `WITHDRAW_UID_WEIGHT`, `UID_WEIGHT_BUDGET_1M`). Task 2/7 moves them to `binance.history-budget.ts` and updates the test imports; no re-export (Knip).
12. **Migration index.** `main`, `next`, and every build-29 branch (`release-29`, `duo-adaptive`, `ios18-fallback`, `keyloss-fix`, `onboarding-fixes*`) end at `0055` on 2026-10-10. This plan takes `0056`. If build 29 lands a migration first, renumber 0056 before merging (never after a build ships).
13. **Capital rows carry `description: 'BTC'`** (`binance.transactions.ts:196`), not `''` as kiko-architecture says. Unchanged here; the task 7/7 skill rewrite fixes the skill text.
14. **The worktree has no `node_modules`.** Task 1/7 step 1/9 runs `npm ci` in this worktree once. Never symlink main's (memory `scratch-copy-never-shares-node-modules`).

## Global Constraints

- Only api.binance.com: no new host, SDK or data recipient. `check:plist` stays unchanged. App Privacy stays "Data Not Collected".
- Of a Pay counterparty, only `name` is stored (in `description`). `binanceId` stays in memory for the direction rule. Email, phone, accountId, card number, institution and digital wallet id are never parsed into a type.
- Logs: fixed tags plus error name/code only (`logFailure`). Never an order id, amount, name, URL or body.
- Every parse error throws an `Error` with a fixed message (no URL, no body).
- Amounts go through `Money.fromMajor('BTC', …)`; a non-finite amount never reaches the `notNull` column.
- Keys are namespaced by account id: `` `${accountId}:<walk>:…` `` (kiko-architecture "Namespaced synced externalId").
- Rows commit (`addManyDedup`) BEFORE the walk's watermark advances. Every walk is idempotent and never fails the balance sync.
- Stored literals `'Binance Pay'` / `'Binance Earn'` are data (proper nouns), never catalogue strings. Every new label is resolved with `t` at render time.
- en and uk catalogues change together (parity test); translator review of new/changed keys before any deploy that ships them.
- Writes to `src/`, `__tests__/`, `rules/` go through Edit/Write only (kill-guard SHELL-WRITE deny). Shipped migrations are never edited.
- No flag-gated or hidden behavior (Guideline 5.6). Every task tip is safe to ship alone: a walk is wired into `run-crypto-sync` only in the task that completes it.

## Review Focus

1. **The newest Pay window.** With capital fully caught up, a Pay run commits its last window and `binancePayHistoryCursor` equals the capital cursor; the next run's Pay start re-scans from that cursor minus the overlap. Pinned in task 4/7. SUPERSEDED (C1): the Pay end is `now`, so the Pay cursor reaches `now`, not the capital cursor.
2. **An old capital row with walletType 1.** A deposit imported on Spot before task 2/7, seen again in the overlap window with `walletType: 1`, stays on Spot: no second row on Funding, and the row count stays the same. Pinned in task 2/7 (real SQLite).
3. **Disconnect, then reconnect.** Every walk cursor is reset to 2017. The Pay walk's first request starts at `max(HISTORY_FLOOR_MS, now - 18 months + 10 days)`, the Transfer walk's at `now - 6 months + 1 day`, the Earn walk's at 2022-01-01. No request asks for older data. Pinned in tasks 4/7, 5/7, 6/7.
4. **An Earn reward group grows on a re-read.** First read [0.00000002] gives `:0` = 2 sat. A re-read of [0.00000001, 0.00000002] gives `:0` = 1 sat (refreshed amount) and `:1` = 2 sat. Total 3 sat, two rows, no duplicate. Pinned in task 6/7 (real SQLite through `addManyDedup`).
5. **Two Binance connections with the same `tranId`.** Each account gets its own legs and its own pair id; no row of one account is refreshed by the other. Pinned in task 5/7.
6. **A Transfer run fits its cap.** A caught-up run reads the forward window (20 calls), one owed range outside the re-scan (20), the re-scan (20) and the points (1 call each) inside the cap of 80; at 60 the owed range starves while a point is owed. Pinned by the Transfer property lane (task 5/7, family a, mutant 8).
7. **A typed point.** A stuck transfer (or Earn record) owes `[t - 1, t + 1]` in its own type (kind) only; its read is one call, and it leaves only for a record of that type with exactly that point. Pinned in task 5/7 (mutants 3-5, 7).

---

## Mutation gate (per change set)

Each task is one change set. Its base is the commit it starts from: task 1/7's base is the merge commit of step 1/9; each later task's base is the previous task's tip. Before BATCH READY the orchestrator runs `KIKO_MUTATION_BASE=<task base> make mutable` and reports the count. The coordinator then runs `KIKO_MUTATION_BASE=<task base> make deep` detached. Never one whole-branch run. Tests, `index.ts`, `.d.ts`, locales and `.js` are excluded by the gate.

| Task | Expected mutable source files | Count |
|---|---|---|
| 1/7 | `binance.client.ts`, `binance.history-client.ts`, `binance.transactions.ts` | 3 |
| 2/7 | `binance.history-budget.ts`, `binance.history-walk.ts`, `binance.holding-keys.ts`, `binance.transactions.ts`, `binance.provider.ts`, `holding-metadata.ts`, `holdings.repo.ts`, `run-crypto-sync.ts` | 8 |
| 3/7 | `src/db/schema.ts` (counted, not scored), `transactions.repo.ts`, `exchange-exclusion.ts`, `category-breakdown.ts`, `statistics.screen.tsx`, `untracked-counterpart.ts`, `exchange-description.ts`, `row-description.ts`, `home.screen.tsx`, `transaction-row.component.tsx`, `holding-detail.screen.tsx`, `transaction-form.screen.tsx`, `example-transaction.component.tsx` | 13 |
| 4/7 | `binance.pay-history.ts`, `binance.history-walk.ts`, `run-crypto-sync.ts` | 3 |
| 5/7 | `binance.transfer-history.ts`, `binance.history-paging.ts`, `binance.history-walk.ts`, `binance.history-records.ts`, `binance.history-client.ts`, `binance.history-budget.ts`, `holding-metadata.ts`, `run-crypto-sync.ts` (step 1/11 adds no file beyond these; `row-labels.test.ts` is a test) | 8 |
| 6/7 | `binance.earn-history.ts`, `holding-metadata.ts`, `run-crypto-sync.ts`, `binance-history-status.ts`, `crypto-sync-section.component.tsx` | 5 |
| 7/7 | none (probe script is gitignored; skill text only) | 0 |

All paths under `src/crypto-sync/binance/` unless shown otherwise. Slow runs to expect: tasks 5/7 and 6/7 mutate `binance.history-walk.ts` (about 850 lines) and `holding-metadata.ts` (about 840); task 3/7 mutates `transactions.repo.ts` (2,859 lines), `transaction-form.screen.tsx` (2,847), `statistics.screen.tsx` (1,307) and `holding-detail.screen.tsx` (1,299); task 2/7 mutates `holdings.repo.ts`. Stryker mutates whole files; quote the ETA from run history (`kiko:estimator`).

## Commands every task uses

- Red/green: `npx jest <test file>` (red: FAIL for the named reason; green: PASS).
- Before BATCH READY, in this order: `bash scripts/wait-load.sh 10` (background, wait on its exit code), `npx jest` (full suite, exit 0, report the count), `npm run check:all` (exit 0), `KIKO_MUTATION_BASE=<task base> make mutable` (exit 0, count <= 30).
- `bash scripts/checks/dup.sh <the task's changed files>` (the Stop-hook scope), and each touched test file on its own.
- BATCH READY names: task, base sha, tip sha, `make mutable` count, full-jest count, `check:all` exit code, reviewer verdict, and (task 3/7) "migration 0056".
- One `kiko:reviewer` pass per task (change set), plus one whole-branch pass in task 7/7. Cheap same-file Minors ride a fix round; no fix round for Minors alone.

---

### binance-history task 1/7: history client reads (developer)

**Files:**
- Modify: `src/crypto-sync/binance/binance.client.ts` (export `signedRequestPage`, `SignedPage`; add `usedWeightsFromHeaders`; `fetchAccount` adds `uid`; move the two capital reads and their types out)
- Create: `src/crypto-sync/binance/binance.history-client.ts`, `src/crypto-sync/binance/binance.history-client.test.ts`
- Modify: `src/crypto-sync/binance/binance.transactions.ts` (imports; reads now return `HistoryPage`, use `.rows`), `binance.transactions.test.ts` (fakes return `HistoryPage`), `binance.client.test.ts` (capital-read cases move to the new test file; `uid` cases added)

**Interfaces (produces):**
```ts
// binance.client.ts
export type BinanceAccount = { balances: BinanceBalance[]; uid: string | null }; // uid: finite integer number or non-empty digit string -> string, else null
export const signedRequestPage: (apiKey, secret, method, path, params, options?) => Promise<SignedPage>;
export const usedWeightsFromHeaders: (headers: Headers) => { usedUidWeight1m: number | undefined; usedIpWeight1m: number | undefined };

// binance.history-client.ts
export type HistoryPage<Row> = { rows: Row[]; usedUidWeight1m: number | undefined; usedIpWeight1m: number | undefined };
export type TotalPage<Row> = HistoryPage<Row> & { total: number };
export type BinanceDeposit = { id; amount; coin; txId; insertTime; status; walletType: number | undefined };
export type BinanceWithdrawal = { id; amount; transactionFee; coin; txId; applyTime; status; walletType: number | undefined };
export const fetchDepositHistory: (apiKey, secret, window: HistoryWindow, options?) => Promise<HistoryPage<BinanceDeposit>>;
export const fetchWithdrawHistory: (apiKey, secret, window: HistoryWindow, options?) => Promise<HistoryPage<BinanceWithdrawal>>;
export type BinancePayParty = { name: string | undefined; binanceId: string | undefined };
export type BinancePayOrder = { orderType: string; transactionId: string; transactionTime: number; amount: string; currency: string;
  walletType: number | undefined; walletTypes: number[] | undefined;
  fundsDetail: { currency: string; amount: string; walletAssetCost: { walletType: number; amount: string }[] }[]; // the API sends a MAP { "<walletType>": "<amount>" }; the client normalizes it to this array
  payerInfo: BinancePayParty; receiverInfo: BinancePayParty };
export const PAY_PAGE_LIMIT = 100;
export const fetchPayHistory: (apiKey, secret, query: { startTime: number; endTime: number }, options?) => Promise<HistoryPage<BinancePayOrder>>;
export const UNIVERSAL_TRANSFER_TYPES: readonly [...20 types];  // MAIN_FUNDING, FUNDING_MAIN + the 18 untracked
export type UniversalTransferType = (typeof UNIVERSAL_TRANSFER_TYPES)[number];
export type BinanceUniversalTransfer = { asset: string; amount: string; type: string; status: string; tranId: string; timestamp: number };
export const HISTORY_TOTAL_PAGE_SIZE = 100;
export const fetchUniversalTransfers: (apiKey, secret, query: { type: UniversalTransferType; startTime; endTime; current: number }, options?) => Promise<TotalPage<BinanceUniversalTransfer>>;
export type EarnRecordKind = 'flexibleSubscription' | 'flexibleRedemption' | 'flexibleRewards' | 'lockedSubscription' | 'lockedRedemption' | 'lockedRewards';
export type EarnRecordByKind = { flexibleSubscription: …; … };  // only the S5 fields, numbers/strings as parsed
export const fetchEarnRecords: <Kind extends EarnRecordKind>(apiKey, secret, kind: Kind, query: { startTime; endTime; current: number }, options?) => Promise<TotalPage<EarnRecordByKind[Kind]>>;
export const BINANCE_HISTORY_PARSE_ERROR = 'Binance history response malformed';
```
The 20 transfer types: `MAIN_FUNDING, FUNDING_MAIN, MAIN_UMFUTURE, UMFUTURE_MAIN, MAIN_CMFUTURE, CMFUTURE_MAIN, MAIN_MARGIN, MARGIN_MAIN, MAIN_OPTION, OPTION_MAIN, MAIN_PORTFOLIO_MARGIN, PORTFOLIO_MARGIN_MAIN, FUNDING_UMFUTURE, UMFUTURE_FUNDING, FUNDING_CMFUTURE, CMFUTURE_FUNDING, FUNDING_MARGIN, MARGIN_FUNDING, FUNDING_OPTION, OPTION_FUNDING`. Check each against the SDK enum in `wallet/.../query-user-universal-transfer-history-type-enum` (or the `type` param doc in `asset-api.ts`); a type missing there is a spec finding, not a silent drop.

- [ ] **step 1/9:** Merge main into the branch (build 29 lands first), in this worktree, with the harness merge pattern:
  ```bash
  cd /Users/drizzer14/orca/workspaces/pff-ios/binance-pay-history
  if git merge-tree --write-tree HEAD main >/dev/null; then git merge --no-ff main -m "Merge main into binance-pay-history"; else echo "STOP: merge-tree exit non-zero (1 = conflicts, other = error)"; fi
  ```
  On conflicts, stop and report. Then `npm ci`. Record the merge commit as TASK1_BASE. Re-check point 12 above (`ls drizzle/migrations | tail`).
- [ ] **step 2/9:** Confirm in the SDK (`binance/binance-connector-js`, the files named in the spec S-table): (a) the `walletAssetCost` item shape, (b) whether `binanceId` is a number or a string, (c) whether flexible `rewardsRecord` requires `type` and its enum values, (d) the max `size` per S4/S5 endpoint if documented. Use `kiko:researcher` (cites URL + date); the orchestrator writes the answers into this task's PR notes. If (c) is required, `fetchEarnRecords('flexibleRewards', …)` takes a `type` and task 6/7 reads one series per value.
- [ ] **step 3/9:** Write the failing tests in `binance.history-client.test.ts` (fake `fetchImpl` recording the URL and init):
  - path and params per read: Pay `/sapi/v1/pay/transactions` with `startTime`, `endTime`, `limit=100`; transfer `/sapi/v1/asset/transfer` with `type`, `startTime`, `endTime`, `current`, `size=100` and NO `asset`; each of the 6 Earn paths with `asset=BTC`, `startTime`, `endTime`, `current`, `size=100`; capital reads unchanged (`coin=BTC`, offset, limit 1000).
  - signing: the query ends `&signature=<hmac>`, `X-MBX-APIKEY` and `Cache-Control: no-store` present (through `signedRequestPage`).
  - header parse: both `X-SAPI-USED-UID-WEIGHT-1M` and `X-SAPI-USED-IP-WEIGHT-1M` parsed; missing or non-numeric gives `undefined`.
  - 429 and 418 throw `BinanceRateLimitError` with `retryAfterMs`.
  - Pay envelope: `code: '000000'` + `data: []` parses; `code: '-1'`, missing `data`, `data` not an array, a non-object body each throw `Error(BINANCE_HISTORY_PARSE_ERROR)` whose message holds no URL and no body text.
  - Transfer/Earn envelope: `{ total: 0 }` with no `rows` gives `rows: []`, `total: 0`; a non-numeric `total` throws the fixed error.
  - PII: a Pay fixture with `receiverInfo.{email, phone, accountId, countryCode, cardNumber, institutionName, digitalWalletId}` parses to an object whose `receiverInfo` has ONLY `name` and `binanceId` keys (`Object.keys` equality), and `payerInfo` the same.
  - `binanceId` given as a number parses to a string.
- [ ] **step 4/9:** Add to `binance.client.test.ts`: `fetchAccount` returns `uid: '123'` for `uid: 123`, `null` for missing, `NaN`, `''`, `1.5`.
- [ ] **step 5/9:** Run `npx jest src/crypto-sync/binance/binance.history-client.test.ts src/crypto-sync/binance/binance.client.test.ts`. Expected: FAIL (module not found / `uid` undefined).
- [ ] **step 6/9:** Implement. Each read is ONE page of ONE window through `signedRequestPage`; parse by explicit field picking (never spread the body). Move `fetchDepositHistory`, `fetchWithdrawHistory`, `HistoryWindow`, `HISTORY_PAGE_LIMIT` and the two record types to `binance.history-client.ts`; both now return `HistoryPage` and parse `walletType`. Update `binance.transactions.ts` to read `.rows` and the withdraw `usedUidWeight1m` from the page and its test fakes. Capital rows now parse strictly, so this is NOT behavior unchanged: see spec section 7, "Strict capital parse".
- [ ] **step 7/9:** Run `npx jest src/crypto-sync`. Expected: PASS. Run `npx tsc --noEmit`.
- [ ] **step 8/9:** Commit `feat(binance): history client reads for Pay, universal transfer, Simple Earn records; account uid`.
- [ ] **step 9/9:** Pre-BATCH-READY commands; `kiko:reviewer` on TASK1_BASE..tip (brief: PII fields absent from types; fixed error messages; no new header code; reads unused by app code are test-only exports, Knip passes). BATCH READY.

### binance-history task 2/7: shared budget, capital walk on it, wallet placement, walk cursors (developer)

**Files:**
- Create: `binance.history-budget.ts` + `.test.ts`, `binance.history-walk.ts` + `.test.ts`, `binance.holding-keys.ts`
- Modify: `binance.transactions.ts` + `.test.ts`, `binance.provider.ts` (import keys/names from `binance.holding-keys.ts`), `src/holdings/holding-metadata/holding-metadata.ts` + its test, `src/holdings/repo/holdings.repo.ts`, `src/holdings/repo/holdings.repo.history-cursor-account-gate.test.ts`, `src/holdings/repo/holdings.repo.test.ts`, `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts` + `.test.ts`, `src/crypto-sync/disconnect/disconnect.test.ts`
- Create: `src/holdings/repo/holdings.repo.ensure-exchange.test.ts` (real SQLite)

**Interfaces:**
```ts
// binance.history-budget.ts
export type BudgetLane = 'capitalWithdraw' | 'capitalDeposit' | 'pay' | 'transfer' | 'earn';
export type CallCost = { uid: number } | { ip: number };
export const UID_WEIGHT_BUDGET_1M = 180_000;
export const IP_BUDGET_1M = 6_000;
export const LANE_CALL_CAPS: Record<BudgetLane, number>; // capitalWithdraw 9, capitalDeposit Infinity, pay 20, transfer 60, earn 30
export const COSTS: { withdraw: { uid: 18_000 }; deposit: { ip: 1 }; pay: { uid: 3_000 }; account: { ip: 20 }; transfer: { ip: 1 }; earn: { ip: 150 } };
export type BinanceRunBudget = {
  canAfford: (lane: BudgetLane, cost: CallCost) => boolean;
  record: (lane: BudgetLane, page: { usedUidWeight1m: number | undefined; usedIpWeight1m: number | undefined }) => void; // +1 call on the lane; a defined reading replaces the last one
};
export const createBinanceRunBudget: () => BinanceRunBudget;
export type BinanceHistoryRun = { gate: RequestGate; budget: BinanceRunBudget };
export const createBinanceHistoryRun: (clock: { now: () => number; sleep: (ms: number) => Promise<void> }) => BinanceHistoryRun; // gate at BINANCE_REQUEST_INTERVAL_MS (moves here)

// binance.holding-keys.ts
export const SPOT_KEY = 'BTC'; export const FUNDING_KEY = 'BTC:funding'; export const EARN_KEY = 'BTC:earn';
export type BinanceWalletKey = typeof SPOT_KEY | typeof FUNDING_KEY | typeof EARN_KEY;
export const WALLET_HOLDING_NAMES: Record<BinanceWalletKey, string>; // 'Binance Spot' | 'Binance Funding' | 'Binance Earn'
export const binanceKeyOf: (holding: Pick<HoldingRow, 'metadata'>) => string | undefined;

// binance.history-walk.ts (shared by every walk)
export type WalkResult = { imported: number; complete: boolean };
export type WalkWindow = { start: number; end: number };
export const buildWalkWindows: (start: number, end: number, windowMs: number, maxWindows: number) => WalkWindow[];
export const resolveWalkStart: (input: { cursor: number | null; floorMs: number; endTime: number; windowMs: number; overlapMs: number }) => number; // null -> floor; else max(floor, min(cursor - overlap, end - window)). REMOVED in task 4/7 fix round 3 (R14): every walk uses planWalkPasses
export const btcSatoshis: (amount: unknown) => number | null; // decimal string or number -> Money.fromMajor('BTC'), null when not finite
export class BinanceWalkStop extends Error { constructor(code: string) } // name 'BinanceWalkStop', own `code` = the fixed tag; logged via logFailure
export const logWalkStop: (code: string) => void;
export type SpanRead<Page> = { kind: 'page'; page: Page } | { kind: 'split'; half: WalkWindow }; // task 4/7 fix round 4 (R18)
export const walkSpans: <Page>(input: { window: WalkWindow; read: (span: WalkWindow) => Promise<SpanRead<Page> | undefined>; commit: (span: WalkWindow, page: Page) => Promise<SpanCommit | undefined> }) => Promise<WindowOutcome>; // the one span loop: halve on split, commit oldest first, 2x next span; read/commit undefined = stop
export const resolveWalletHoldings: (input: { accountId; keys: BinanceWalletKey[]; listHoldings; ensureHoldings }) => Promise<Map<BinanceWalletKey, HoldingRow>>; // P7: ensure missing keys at 0, then re-list
// HISTORY_FLOOR_MS stays exported from binance.transactions.ts (disconnect imports it)

// holding-metadata.ts
export const BINANCE_PAY_HISTORY_CURSOR_FIELD = 'binancePayHistoryCursor';
export const BINANCE_TRANSFER_HISTORY_CURSOR_FIELD = 'binanceTransferHistoryCursor';
export const BINANCE_EARN_HISTORY_CURSOR_FIELD = 'binanceEarnHistoryCursor';
export const BINANCE_PAY_RESCAN_CURSOR_FIELD = 'binancePayRescanCursor'; // task 4/7 fix round 2; tasks 5/7 and 6/7 add their own re-scan key the same way
export const BINANCE_HISTORY_RESCAN_CURSOR_FIELD = 'binanceHistoryRescanCursor'; // task 4/7 fix round 3 (R14): the capital walk's re-scan mark
export const binanceWalkCursorFields: readonly [capital, capitalRescan, pay, payRescan, transfer, earn]; export type BinanceWalkCursorField;
export const binanceWalkCursorOf: (field: BinanceWalkCursorField, metadata: unknown) => number | null;
export const BINANCE_PAY_POINT_CURSOR_FIELD = 'binancePayPointCursor'; // the start of the owed point the walk read last (round-robin of the points)
export const BINANCE_HISTORY_POINT_CURSOR_FIELD = 'binanceHistoryPointCursor';
export const binanceWalkPointCursorFields: readonly [capital, pay]; export type BinanceWalkPointCursorField; export type BinanceWalkNumberField = BinanceWalkCursorField | BinanceWalkPointCursorField;
export const binanceWalkPointCursorOf: (field: BinanceWalkPointCursorField, metadata: unknown) => number | null | undefined; // null: none stored, undefined: malformed
// walkOwnedMetadataKeys = binanceWalkCursorFields + binanceWalkPendingFields + binanceWalkPointCursorFields (a disconnect drops the point cursors)

// holdings.repo.ts
setBinanceWalkCursor: (holdingId: string, field: BinanceWalkNumberField, cursorMs: number) => Promise<void>; // replaces setBinanceHistoryCursor; same institution = 'binance' gate
ensureExchangeHoldings: (holdingsList: ExchangeHolding[]) => Promise<void>; // one write; insert when no row of that account has the key; an existing row (open or closed) is never touched

// binance.transactions.ts
export const syncBinanceTransactions: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?) => Promise<WalkResult>;
```

- [ ] **step 1/8:** Write the failing tests:
  - `binance.history-budget.test.ts`: each lane's cap (9th withdraw call allowed, 10th not; deposit never capped by count; pay 20; transfer 60; earn 30). UID: reading 162000 + 18000 = 180000 affordable, 162001 not. IP: reading 5850 + 150 = 6000 affordable, 5851 not. A cost of one kind ignores the other reading. Without any header, only the caps apply. `record` with `undefined` keeps the last reading. One lane's spent cap leaves another lane affordable.
  - `binance.history-walk.test.ts`: `resolveWalkStart` (null cursor -> floor; cursor 2017 with a 2025 floor -> floor; normal cursor -> `min(cursor - overlap, end - window)`); `buildWalkWindows` (contiguous, last ends at `end`, cap honored); `btcSatoshis` ('0.001' -> 100000; 'x', NaN, Infinity -> null); `BinanceWalkStop` has `name` and `code`; `resolveWalletHoldings` calls `ensureHoldings` only for missing keys, with balance 0, `metadataField: 'binanceAsset'`, name from `WALLET_HOLDING_NAMES`, and no `syncedAt` in metadata.
  - `holdings.repo.ensure-exchange.test.ts` (real SQLite, `applyAllMigrations`): missing key -> inserted at balance 0; existing open row with balance 5 -> untouched (balance 5, name, metadata); existing CLOSED row -> untouched; a key of ANOTHER account does not count as existing.
  - `holdings.repo.history-cursor-account-gate.test.ts`: rewrite for `setBinanceWalkCursor` with each of the four fields; still a no-op after disconnect; other metadata keys kept.
  - `holding-metadata` test: all four keys carried by `withWalkOwnedMetadataCarried`; all four reset by `withWalkOwnedMetadataResetToFloor`; `statementFromMs` still not reset.
  - `disconnect.test.ts`: a Spot holding with all four cursors -> all four at `HISTORY_FLOOR_MS`.
  - `binance.transactions.test.ts`, placement matrix with the was: column:

    | # | input | result | was: |
    |---|---|---|---|
    | C1 | deposit `walletType: 0` | Spot | Spot |
    | C2 | deposit `walletType: 1` | Funding | Spot |
    | C2w | withdrawal `walletType: 1` | Funding | Spot |
    | C3 | `walletType` absent | Spot | Spot |
    | C4 | `walletType: 7` (unknown) | window stops, `capital-wallet-unknown` logged, cursor unmoved | Spot |
    | P7 | C2 with no Funding holding | Funding created at 0, row placed on it | n/a |

    Plus: the withdraw budget now comes from the shared run (cap 9 and the 18000 UID rule unchanged, existing cases re-pointed); a deposit page with `usedIpWeight1m` 5999 stops the window before the next deposit call; the cursor write goes through `writeWalkCursor(spotId, 'binanceHistoryCursor', end)`.
  - Review Focus 2 (real SQLite, in `binance.transactions.test.ts` or a new `binance.transactions.placement.test.ts`): a deposit stored on Spot under `${accountId}:deposit:7`, re-imported with `walletType: 1` -> still one row, still on Spot.
  - `run-crypto-sync.test.ts`: one `createBinanceHistoryRun` per arm, passed to the capital walk; a capital walk failure is logged by `logOnFailure` with tag `'[binance sync] capital history failed'` and the balance result still returns.
- **M1, from task 1/7 review:** `binance.transactions.ts` still silently skips a SETTLED capital row with a non-numeric amount string, an unparseable `applyTime` string, or no `id` and no `txId`. Make each a stop (fixed tag, as C4) with its own C-matrix row.
- [ ] **step 2/8:** Run `npx jest src/crypto-sync src/holdings`. Expected: FAIL (missing modules, `setBinanceWalkCursor` not a function, C2 on Spot).
- [ ] **step 3/8:** Implement `binance.history-budget.ts`, `binance.holding-keys.ts`, `binance.history-walk.ts`; move `BINANCE_REQUEST_INTERVAL_MS` and the three withdraw-budget constants into the budget file; `binance.provider.ts` imports the keys and names.
- [ ] **step 4/8:** Implement `holding-metadata.ts` keys and `holdings.repo.ts` (`setBinanceWalkCursor`, `ensureExchangeHoldings`); remove `setBinanceHistoryCursor`; update every caller (`grep -rn setBinanceHistoryCursor src`).
- [ ] **step 5/8:** Rework `binance.transactions.ts` onto `run.gate` / `run.budget` (lanes `capitalWithdraw`, `capitalDeposit`), placement by `walletType` (0 or absent -> Spot, 1 -> Funding, else stop), P7 through `resolveWalletHoldings`, and `writeWalkCursor`. Deps gain `ensureHoldings` and `writeWalkCursor`; `sleep` leaves the walk deps (the gate comes from the run).
- [ ] **step 6/8:** Wire `run-crypto-sync.ts`: after `runBalanceSync`, `const run = createBinanceHistoryRun({ now: Date.now, sleep })`, then `await logOnFailure('[binance sync] capital history failed', () => syncBinanceTransactions({ targetAccountId, run }))`.
- [ ] **step 7/8:** Run `npx jest src/crypto-sync src/holdings src/screens/account-detail`, then `npx tsc --noEmit`. Expected: PASS. Commit `feat(binance): shared history run budget, capital placement by walletType, walk cursors`.
- [ ] **step 8/8:** Pre-BATCH-READY commands; `kiko:reviewer` (brief: budget numbers equal the old withdraw rule; `ensureExchangeHoldings` never writes an existing row; C2 cannot move an existing row; the cursor gate kept). BATCH READY.

### binance-history task 3/7: migration 0056, exclusion, transfer labels (developer, then reviewer)

**Files:**
- Create: `drizzle/migrations/0056_add_untracked_counterpart.sql`, `drizzle/migrations/meta/0056_snapshot.json` (generated), `drizzle/migrations/0056-add-untracked-counterpart.test.ts`
- Modify: `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js` (generated), `src/db/schema.ts` (transactions, after `exchangePairId`)
- Modify: `src/transactions/repo/transactions.repo.ts` (`NewTransaction` gains the three marker fields)
- Create: `src/transactions/repo/transactions.repo.markers.test.ts` (real SQLite)
- Modify: `src/statistics/exchange-exclusion/exchange-exclusion.ts` + test, `src/statistics/category-breakdown/category-breakdown.ts`, `src/screens/statistics/statistics.screen.tsx`
- Create: `src/transactions/untracked-counterpart/untracked-counterpart.ts` + `index.ts` + `.test.ts`
- Modify: `src/transactions/exchange-description/exchange-description.ts` + test, `src/transactions/row-description/row-description.ts` + test, `src/screens/home/home.screen.tsx`, `src/screens/home/transaction-row/transaction-row.component.tsx`, `transaction-row.props.d.ts`, `src/screens/holding-detail/holding-detail.screen.tsx`, `src/screens/forms/transaction-form/transaction-form.screen.tsx`, `src/design-system/components/example-transaction/example-transaction.component.tsx`
- Modify: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts` (`transactions.transferTo`, `transactions.transferFrom`)
- Modify: `src/data-transfer/import-data.back-compat.test.ts`; any two-path test that selects `transactions` through Drizzle from an older tag (`restore-exchange-pair.two-path.test.ts`, `restore-sets-balance.two-path.test.ts`, `restore-snapshot.test.ts`): use `columnsWithout(getTableColumns(transactions), 'untrackedCounterpart')`, the 0047 precedent

**Interfaces:**
```ts
// schema.ts
untrackedCounterpart: text('untracked_counterpart'), // nullable; WHY comment: one-leg move to a wallet Kiko does not track; code `wallet:<TYPE>`; excluded from spending; label at render time
// untracked-counterpart.ts
export const UNTRACKED_WALLETS = ['UMFUTURE', 'CMFUTURE', 'MARGIN', 'OPTION', 'PORTFOLIO_MARGIN'] as const;
export type UntrackedWallet = (typeof UNTRACKED_WALLETS)[number];
export const untrackedWalletCode: (wallet: UntrackedWallet) => `wallet:${UntrackedWallet}`;
export const untrackedCounterpartName: (code: string | null) => string | undefined; // product name for a known wallet: code, else undefined
// names (proper nouns, not catalogue): UMFUTURE 'USDⓈ-M Futures', CMFUTURE 'COIN-M Futures', MARGIN 'Margin', OPTION 'Options', PORTFOLIO_MARGIN 'Portfolio Margin'
// exchange-description.ts
exchangeLegDescription(input: { counterpartName: string; amountMinorUnits: number; sameCurrency: boolean; t: TFunction }): string;
export const transferLegDescription(input: { counterpartName: string; amountMinorUnits: number; t: TFunction }): string;
// row-description.ts
transactionRowDescription(input: { transaction: Pick<TransactionRow, 'holdingId' | 'description' | 'amountMinorUnits' | 'exchangeCounterpartHoldingId' | 'untrackedCounterpart'>; holdingName; holdingNameById; holdingCurrencyById: ReadonlyMap<string, string>; t }): string;
// order: stored description -> paired leg (transfer when both currencies known and equal, else exchange) -> known untracked code (transfer) -> default income/expense label
```

- [ ] **step 1/10:** Write `0056-add-untracked-counterpart.test.ts` in the shape of `0055-add-dismissed-tips.test.ts`: `applyMigrationsThrough(db, '0055_add_dismissed_tips')`, insert one transaction row; assert (1) no `untracked_counterpart` before; (2) after: `text`, `notnull = 0`, `dflt_value = null`; (3) the existing row reads `null`; (4) a row with `'wallet:UMFUTURE'` round-trips; (5) no index on the column (`pragma_index_list('transactions')` unchanged, count equal before/after).
- [ ] **step 2/10:** Write the other failing tests:
  - `transactions.repo.markers.test.ts`: `addManyDedup` stores `exchangeCounterpartHoldingId`, `exchangePairId`, `untrackedCounterpart`; a second `addManyDedup` of the same key with a changed amount refreshes the amount and leaves the three markers as stored.
  - `exchange-exclusion.test.ts`: a row with only `untrackedCounterpart` set is excluded; a row with neither marker is not.
  - `untracked-counterpart.test.ts`: every wallet code maps to its name; `'asset:ETH'`, `'wallet:FOO'`, `''`, `null` give `undefined`.
  - `exchange-description.test.ts` / `row-description.test.ts`: BTC->BTC paired leg, negative -> "Transfer to Binance Funding", positive -> "Transfer from …"; BTC->UAH leg -> "Exchange to …" (unchanged); counterpart missing from `holdingCurrencyById` -> exchange label (unchanged behavior); `wallet:UMFUTURE` negative -> "Transfer to USDⓈ-M Futures"; unknown code -> the default income/expense label; a stored description wins over both. Use the real `en` catalogue through the existing test `t`.
  - `import-data.back-compat.test.ts`: an export whose transaction rows lack `untrackedCounterpart` imports, and every restored row reads `null`.
  - Statistics: one case in the existing statistics screen or category-breakdown test that an `untrackedCounterpart` row is out of the spending pie.
- [ ] **step 3/10:** Run `npx jest drizzle/migrations/0056-add-untracked-counterpart.test.ts src/transactions src/statistics src/data-transfer`. Expected: FAIL.
- [ ] **step 4/10:** Add the schema column with its WHY comment. Run `npx drizzle-kit generate --name add_untracked_counterpart`, then `./node_modules/.bin/biome check --write drizzle/migrations`. The SQL body is exactly ``ALTER TABLE `transactions` ADD `untracked_counterpart` text;``. Prepend the 0055-style `/* */` header: purpose; additive, one ADD COLUMN, no index, no backfill, so a crash leaves 0055 and it retries whole; an old `.kiko` restores `null`. Re-check the `migrations.js` layout.
- [ ] **step 5/10:** Widen `NewTransaction`; implement exclusion and the statistics mappings; implement `untracked-counterpart.ts`, the label branches, and the `holdingCurrencyById` plumbing in every caller (`tsc` lists them).
- [ ] **step 6/10:** Add `transactions.transferTo: 'Transfer to {{name}}'`, `transferFrom: 'Transfer from {{name}}'` (en) and `'Переказ на {{name}}'`, `'Переказ з {{name}}'` (uk), next to `exchangeTo/From`.
- [ ] **step 7/10:** Run `npx jest drizzle/migrations src/db src/data-transfer src/transactions src/statistics src/screens src/design-system src/i18n`, then `npx tsc --noEmit`. Expected: PASS. Commit `feat(transactions): untracked_counterpart column (0056), spending exclusion, transfer labels`.
- [ ] **step 8/10:** `kiko:reviewer` on the migration (before BATCH READY). Brief: (1) one additive nullable ADD COLUMN, snapshot matches, journal idx 56 with no collision on `main`/`next`; (2) which existing queries touch `transactions` (`listAllQuery`, `listByHoldingQuery`, `listWithContextBetweenQuery`, `readDataSnapshot`, `restoreDataSnapshot`, `addManyDedup` upsert) and which index each uses now: none changes, no new index, so no EXPLAIN QUERY PLAN test (the reviewer confirms); (3) an old `.kiko` and a 0055 database both work; (4) the header states the crash-safe order.
- [ ] **step 9/10:** `kiko:reviewer` on the rest of the diff (same pass is fine): label order, the manual same-currency relabel, Semgrep `kiko-no-direct-default-transaction-description` still satisfied. Fix Critical/Important.
- [ ] **step 10/10:** Pre-BATCH-READY commands. BATCH READY names "migration 0056" and lists the new en/uk keys for translator review before any deploy.

### binance-history task 4/7: Pay walk (developer)

**Files:**
- Create: `binance.pay-history.ts`, `binance.pay-history.test.ts`, `binance.pay-history.direction.test.ts` (matrix), `binance.pay-history.real-sqlite.test.ts` (idempotence and a Pay row beside a capital row of the same size, through the real repos)
- Modify: `binance.history-walk.ts` (only if a helper is shared with task 5/7; else untouched), `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts` + test

**Interfaces:**
```ts
export const PAY_WINDOW_MS = 89 * DAY_MS;
// no overlap guard and no cap on the capital cursor (user ruling C1): `binance.overlap-guard.ts` is gone
export const payFloorMs: (now: number) => number; // max(HISTORY_FLOOR_MS, now - 18 calendar months (UTC) + 10 days)
export type PayDirection = 'out' | 'in';
export const payDirection: (order: BinancePayOrder, uid: string | null) => PayDirection | null; // null = stop
export const payDescription: (order: BinancePayOrder, direction: PayDirection) => string; // trimmed counterparty name or 'Binance Pay'
export const syncBinancePayHistory: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?: Partial<BinancePayHistoryDeps>) => Promise<WalkResult>;
// deps: now, readCredentials, listHoldings, fetchAccount, fetchPayHistory, ensureHoldings, addTransactions, writeWalkCursor
```
Rules (spec section 4): window end = `now`; the Pay walk does not read the capital cursor (C1). Direction (R13): from the uid alone (payer id = uid is out, receiver id = uid is in), the sign must agree, otherwise `pay-direction-ambiguous`; an unknown uid stops the run before any request (`pay-uid-unavailable`). Adaptive window instead of paging by a cursor: request the span; a full page (`gathered >= PAY_PAGE_LIMIT`, counted over every coin) halves it (`end = start + floor((end - start) / 2)`) and asks again; a page that is not full commits its rows, moves the Pay cursor to the span's end (never back, never past now), and the next span starts at that end and is twice as wide, up to the window's end. A 1 ms span that is still full is `pay-page-stuck`: in the forward pass it stops that pass (the cursor stays); in the pending pass and the re-scan the orders it shows commit and the whole span stays owed. No request has `startTime == endTime`. Budget lane `pay`, cost `COSTS.pay`; the uid read costs `COSTS.account` on the same lane. Key `` `${accountId}:pay:${orderType}:${transactionId}:${walletType}` ``. Overlap guard and capital cap: REMOVED (user ruling C1, probe Q5: 0 of 5 Pay BTC rows match a capital row); the codes `pay-overlap-skip` and `capital-overlap-skip` are gone, and a Pay row beside a capital row of the same size stays. A non-BTC order the USER paid with BTC funds stops the forward pass at its span (`pay-btc-funded-other-coin`, cursor unmoved); in the pending pass and the re-scan the other orders of its span import and the order stays owed at its own point (the whole span when it has no time or one outside the span); one the user received (the user is the receiver and not the payer) is ignored (B4: the BTC left the payer's wallet, not the user's); user ruling I5 = A2: the stop stays, and option A (import the BTC part) is built only when a real BTC-funded non-BTC order the user paid is seen. Wallet ids (Q9): the client reads `walletType` and each `walletTypes` entry as an integer or a digit string. Category null. No markers.
- **Forward pass first, then a stored re-scan (ruling R11, fix round 2).** A run is two passes, shared in `binance.history-walk.ts` (`planWalkPasses`, `rescanCursorAfter`, `runWalkPlan`, and, from fix round 4, the span loop `walkSpans`; tasks 5/7 and 6/7 reuse them with their own re-scan key). Forward (rulings R16 and R19, fix rounds 4 and 5): from the cursor (`max(floor, cursor ?? floor)`) to the end, moving the cursor; it never starts behind the cursor, because a forward pass that restarted a day behind it would spend every run on a dense day there (900 Pay orders, 4000 capital records), the cursor would not move, and the newer records would never import. Re-scan: with the budget the forward pass left, `[base, forward start)` with `base = max(floor, min(end - walk window, forward start - RESYNC_OVERLAP_MS))`, which covers the day behind the cursor even after an absence just under the window, driven by a walk-owned metadata key (`binancePayRescanCursor`; in `binanceWalkCursorFields`, so a balance sync carries it and a disconnect resets it to the floor). It never writes the forward cursor (a forward commit compares with the cursor the run last wrote, not the one it found), resumes on the next run from its stored key until it reaches the forward start, then stores the 2017 floor (= no pass in progress) so the next run starts a new pass. A stored mark above the floor, at or after the base and before the forward start is resumed over `[mark, forward start)`; a mark behind the base is a pass the sliding window has outrun and starts a new pass at the base, whatever the distance. Re-scan rows use the same keys. **Pending overlap days (fix round 7, spec section 4; replaces the first-run pin `WalkPlan.rescanPin` and the round-6 leftover bound):** each walk keeps its own walk-owned list of owed ground (`binancePayPendingOverlap`, capital `binanceHistoryPendingOverlap`; `{ start, end }` ranges, oldest first, in `binanceWalkPendingFields`, carried over a balance sync, reset to `[]` on disconnect, parsed strictly: a malformed value owes `[floor, cursor)` once, stored at once, plus the fixed code `pending-malformed`). The overlap day `[forward start - overlap, forward start)` is stored before the first forward span moves the cursor (`WalkPlan.pendingRanges`), a committed re-scan or pending span takes the ground it read out of the list, only the floor drops a range unread, at most 12 ranges (the two nearest merge). A run is forward, then the owed ranges the re-scan will not read (oldest first, `WalkPass` `pending`; a budget or rate limit ends the pass, not the run), then the re-scan, then the owed points. Fix round 11 (rulings R24, R25): a read in the pending pass and the re-scan commits every record it can trust (`binance.history-records.ts`: `settleRecords`, `commitSettledSpan`); a stop tied to one record with a time inside the span owes only that record's point (`[t - 1, t + 1]` on Pay and for a deposit, `[T - 1000, T + 1000]` for a withdrawal, whose applyTime may be cut or rounded to the second: the record sits strictly inside under any end Binance leaves out; never cut to the span, so a record on the boundary of two spans owes one point), any other stop, or a record with no usable time, owes the whole span; the rows are written first, then ONE list write (the read span out, the points in), then, in the re-scan, the mark; a stop in the re-scan owes its point and the mark moves on; the forward pass leaves a span uncommitted on any stop and ends the forward pass (`STOP_ENDS_PASS`; the cursor never passes the stuck record); that the run then goes on to the owed ranges, the re-scan and the points is the OVERNIGHT DEFAULT of item 17 below, pending the user, and is not part of the user ruling of 2026-10-11. Fix round 13 (ruling R29): a list entry is a range (no `kind`) or a point (`kind: 'point'`), and the kind alone tells them apart, so a short range (a sliver) is read once and leaves, and a point is never merged into, held by or dropped with a range. A point leaves the list only when a span that holds all of it was read and returned a record whose own point is exactly this one (every returned record counts, the trusted ones too), or by the floor: a read that returned nothing, only the neighbours of the stuck record (Binance filters on another field or rounds the time), or a span that holds part of the point (a window read in halves) keeps it. The points are read LAST, one read each, in a round-robin: one stored point cursor per walk (`binancePayPointCursor`, capital `binanceHistoryPointCursor`, in `binanceWalkPointCursorFields`: carried over a balance sync, dropped on disconnect, a malformed value repaired at once to a start before every point and logged once under the code `point-cursor-malformed`) holds the start of the point read last, which moves past a point once its read has started, whether or not its window finished; the next run reads the points after it first, then wraps (`startingAfter`), so each of P points is read within `ceil(P / L)` runs whose forward pass leaves a call, L >= 1 the points such a run reads. Points that are the same window are one point, two that start together and differ stay as two (the run reads the wider window), and a point is never merged with a range; at most 12 ranges (the two nearest merge). The owed windows leave the lane's last calls for the re-scan (`RESCAN_KEEP`) and for the points (`POINT_KEEP`); `BinanceRunBudget.canAfford` takes the calls to keep. User ruling 2026-10-11: a non-BTC order the user paid with BTC funds stays unimported and owed at its own point (its `transactionTime`, `BtcFundedOtherCoinOrder`) in the pending pass and the re-scan, and the other orders of the span import; the forward pass keeps the stop of A2 (cursor unmoved). Properties P1-P6 and SL are pinned by `binance.history-walk.properties.test.ts` on the Pay (19 reads), capital withdrawals (9 reads), capital withdrawals with a rounded applyTime (9 reads) and capital withdrawals with deposits (9 reads) lanes, each under a read that returns both ends of a range, one that leaves the start out and one that leaves the end out: P1 every other owed row and re-scan row imports, P2 every stuck record is owed as the very point it owes and stays one (a record where two spans meet is held by one; a point that starts with another stays beside it), P3 an owed point costs at most one read a run, P4 the re-scan reads and commits in every run whose forward pass leaves two calls, P5 every run whose forward pass leaves a call and that plans a point reads one and each point is read within `ceil(P / L)` such runs (P up to 30, runs an hour, a day and 2^32 ms apart, a re-scan pass that spans several runs, a point window that comes back full with one call left, a forward pass that spends every call of the first runs), P6 the cursor never passes a stuck record of the forward pass, SL a range with no record, of any length, leaves once it is read and no point appears; also a filter-mismatch reading (a read of a point returns the neighbours and never the stuck record: the point stays) and, on the mixed lane, two points that start together; each test names its bound in runs. Tests (Pay AND capital): two absences longer than the window with the run cut between the forward pass and the re-scan, a cursor 250 days stale on a dense account, a stop inside one owed day starves neither the window re-scan nor the other days (and keeps only its stuck record owed, at its point), a hull a merge past the 12-range cap made beside a stuck range imports its unrelated day, a new owed range is read on the first run behind older stuck ranges, a stuck record imports once it can be placed and a later run imports 0, an in-window re-scan mark outrun by an absence, a disconnect resets the list, the floor drops a passed day and cuts a crossed one, a second identical run imports 0, a corrupt list owes `[floor, cursor)` and its old records import, a rate limit in an owed day. Tests: 900 orders in 88 days (cursor 2 days behind: newest orders import on run 1, cursor reaches the end, the re-scan finishes over later runs, idempotent after), a dense day (900 Pay orders, 4000 capital records) just behind the cursor (cursor reaches now on run 1, the re-scan imports the day over later runs, a second run imports 0), key reset on disconnect, real-SQLite re-scan.
- **Shared span loop and wallet rule (ruling R17/R18, fix round 4).** `walkSpans({ window, read, commit })` in `binance.history-walk.ts` is the one span loop (Pay and capital use it; tasks 5/7 and 6/7 reuse it): `read(span)` gives `{ kind: 'page', page }`, `{ kind: 'split', half }` or `undefined` (a clean stop); `commit(span, page)` gives `{ imported, owed }` or `undefined` (a stop). A full span is answered with its first half (`halfOf`); a span of one millisecond that is still full is committed as a page that owes the whole span (`pay-page-stuck`), which stops only the forward pass. `advanceWalkMarks` takes a `Record<'cursor' | 'rescan', BinanceWalkCursorField>` field map instead of a write lambda that picks the field. Pay placement: the single wallet is the one `walletTypes` entry (`walletType` only when `walletTypes` is absent), the key's wallet segment is that wallet, and for an OUTGOING order (ruling R20, subset rule, fix round 5) the wallets with a cost above zero must be a non-empty set contained in the named wallets with costs adding up to `abs(amount)`, the rows follow the costed wallets (a named wallet with no cost gets no row), else stop `pay-split-mismatch` (no new code); an order with no cost above zero stops. A send with no BTC `walletAssetCost` entry at all and `walletTypes` naming exactly one wallet is placed whole on that wallet (B5) when its BTC `fundsDetail` entries add up to `abs(amount)` (an EMPTY `fundsDetail`: stop `pay-split-mismatch`, B7, fix round 8; a cost-less BTC entry below the amount with the rest paid in another coin: stop `pay-split-mismatch`; funds in another coin and no BTC entry: `pay-funds-not-btc`); `walletTypes` absent, `[1,2]` with no costs, and a zero or inconsistent cost list still stop. A RECEIVE (ruling R22, replaces R21) is placed by DATE: `transactionTime` before 2026-09-29T00:00:00Z is Funding, at or after it Spot, reading none of `walletType`, `walletTypes`, `walletAssetCost`; a receive listing two wallets no longer stops. The funds stops (`pay-funds-not-btc`, `pay-btc-funded-other-coin`) apply to sends only (B4): the client reports the Binance ids of the parties of a BTC-funded non-BTC order and the walk ignores one whose receiver is the user and whose payer is not. The old stop "walletType disagrees with a single walletTypes entry" is gone.
- **Capital walk on the same passes (ruling R14, fix round 3).** `binance.transactions.ts` uses `planWalkPasses` / `runWalkPlan` with its own re-scan key `binanceHistoryRescanCursor` (in `binanceWalkCursorFields`, so a balance sync carries it and a disconnect resets it) and its own point cursor `binanceHistoryPointCursor`; a stuck deposit owes `[t - 1, t + 1]`, a stuck withdrawal `[T - 1000, T + 1000]`. The shared span helpers `halfOf`, `nextSpanAfter` and `advanceWalkMarks` moved into `binance.history-walk.ts`; `resolveWalkStart` and `logWalkNotice` are removed. A span whose first page is full is halved instead of paged through (a 1 ms span is offset-paged), so a heavy window commits span by span and its re-scan finishes over later runs. The old probe test ("a window with more withdrawal pages than one run affords never commits") is replaced by a progress test: 12,000 withdrawals in 88 days, newest import on run 1, cursor reaches the end, the re-scan finishes over later runs, a second identical run imports 0.
- **Decided (user ruling I5 = A2, 2026-10-10):** `pay-btc-funded-other-coin` stays a stop. Option A (import the BTC part of a BTC-funded non-BTC order as an outgoing BTC row on the wallet that paid) is built only when a real such order is seen; the probe saw 0 of 41.
- **Decided (user ruling, 2026-10-11, option A: the other rows import):** in the pending pass and the re-scan the other orders of a span import and only the order the walk cannot trust stays unimported, owed at its own point; the forward pass keeps the stop of A2 (cursor unmoved). Whether the run then goes on to the owed ground, the re-scan and the points is not part of that ruling: see OVERNIGHT item 17.

- [ ] **step 1/7:** Write the failing tests. `binance.pay-history.direction.test.ts`, one `it` per spec "Pay direction" row (R13: rows 1-14; the uid decides, the sign must agree, an unknown uid, a uid matching neither party or both, and a sign that disagrees all stop; row 4 is the live probe's real receive shape). Placement P1-P6 (`walletType` 2 Spot, 1 Funding, 5 Earn; a send is placed by its costs (R20 subset rule): the wallets with a cost above zero are non-empty, contained in `walletTypes`, and sum to `abs(amount)` -> one row per costed wallet with its own key (`[1,2]` costed on both -> two rows, costed on one -> one row); sums differ, a positive cost on an unnamed wallet, or no cost above zero -> stop `pay-split-mismatch`; a single wallet is the one `walletTypes` entry (`walletType 1` with `[2]` -> Spot); a send with no BTC cost entry and one `walletTypes` entry -> that wallet (B5), only when its BTC funds entries equal `abs(amount)` (a cost-less BTC entry plus another-coin entry below the amount -> stop `pay-split-mismatch`); a receive is placed by date (R22: one ms before 2026-09-29T00:00:00Z -> Funding, at it -> Spot; `[1,2]` or `[2]` -> by date, no stop); B4: a BTC receive whose funds are only USDT is imported, a USDT receive with a BTC funds entry is ignored, the same two shapes as sends stop); 3/4/6/unknown -> stop) and P7 (Earn missing -> created at 0). In `binance.pay-history.test.ts`: `currency !== 'BTC'` ignored; non-BTC order with a BTC `fundsDetail` entry that the user paid -> stop `pay-btc-funded-other-coin`, cursor unmoved (one the user received is ignored, B4); empty `transactionId` -> stop; windows from `payFloorMs` (fake clock 2026-10-10 -> floor 2025-04-20); Review Focus 3 (cursor at 2017 -> first `startTime` equals the floor); re-sync forward start AT the cursor (`max(floor, cursor ?? floor)`, never behind it) and the re-scan of `[base, forward start)` behind it, `base = max(floor, min(end - window, forward start - overlap))` (see the forward-first rule below); the adaptive window (an oldest-first and a newest-first history, each with the end open and closed; a same-ms tie across a full page; a window needing more calls than one run's cap progresses on the next run; no request with `startTime == endTime`; a 1 ms full span -> stop, cursor unmoved); capital cursor null -> the Pay walk runs (C1); no request ever starts before `payFloorMs`, in either pass, after a disconnect reset or with an old cursor (Q6); budget (`usedUidWeight1m` 177001 -> next call unaffordable -> `complete: false`, committed windows kept; cap 20); 429 -> cooldown set, `complete: false`; cooldown active -> zero requests; a rows-then-cursor order assertion (cursor write after `addTransactions`); a stop logs only a `BinanceWalkStop` code (spy on `console.warn`: no amount, id or name in the args). `binance.pay-history.real-sqlite.test.ts` (C1: no overlap guard): a Pay row beside a committed capital deposit of the same size (9 min apart) is kept; a Funding Pay receive beside a Spot deposit creates the Funding wallet and keeps its row; a Pay row stored first and a same-size capital deposit imported later -> both rows stay; two same-size Pay receives beside one capital deposit -> both kept; a Spot holding with no capital cursor runs the walk; a second identical run imports 0 new rows. `run-crypto-sync.test.ts`: order capital -> Pay with the SAME `run` object; a Pay failure is logged (`'[binance sync] pay history failed'`) and the balance result returns; a capital 429 (cooldown set) -> the Pay walk makes no request.
- **M2, from task 1/7 review:** `fetchPayHistory` parses every coin's Pay rows strictly, so one off-contract non-BTC row stalls the BTC walk. Decide this first (for example read `currency` first and parse strictly only BTC rows, keeping the gathered count for the pager) and pin it with a test.
- [ ] **step 2/7:** Run `npx jest src/crypto-sync/binance/binance.pay-history`. Expected: FAIL (module missing).
- [ ] **step 3/7:** Implement `binance.pay-history.ts` (pure helpers first, then the walk). Read `payerInfo.binanceId` / `receiverInfo.binanceId` for the direction rule and the B4 receiver check; never store or log them.
- [ ] **step 4/7:** Wire into `run-crypto-sync.ts` after the capital walk: `await logOnFailure('[binance sync] pay history failed', () => syncBinancePayHistory({ targetAccountId, run }))`. Export from the barrel.
- [ ] **step 5/7:** Run `npx jest src/crypto-sync`, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **step 6/7:** Commit `feat(binance): Pay history walk (direction, placement, nickname description)`.
- [ ] **step 7/7:** Pre-BATCH-READY commands; `kiko:reviewer` (brief: direction matrix vs spec; PII: only `name` stored, `binanceId` never leaves the function; logs fixed; no read of the capital cursor). BATCH READY.

### binance-history task 5/7: deferred minors, multi-series shared walk, Transfer walk (developer)

**Shared walk: yes.** The Transfer walk runs on the task 4/7 walk: `planWalkPasses`, `runWalkPlan`, `walkSpans`, `settleRecords`, `commitSettledSpan`, `advanceWalkMarks`, per-record commits, owed points, the round-robin point cursor, `STOP_ENDS_PASS`, `RESCAN_KEEP`, `POINT_KEEP`, and R28 (OVERNIGHT 17). Paging by `current` + `total` fits it: `walkSpans` needs only "the whole page of this span, or the half to read instead", and `fetchAllByTotal` gives that. Two facts differ from Pay and capital. The shared code takes each as a parameter, and its default keeps Pay and capital unchanged:
1. One span read is one call per transfer type (20). The keeps count calls, so `runWalkPlan` takes `callsOf(window)` and keeps the calls of one re-scan read and of one point read.
2. A stuck transfer is owed only in its own type. An owed point carries that type (`series`), so a point read is one call, not 20.

Rejected: a point read of all 20 types (20 calls a point; with the cap, about one point a run). Rejected: one walk state per type (80 metadata keys).

**Files:**
- step 1/11 (deferred minors): `binance.history-walk.ts`, `binance.history-records.ts`, `src/holdings/holding-metadata/holding-metadata.ts` (comment), `binance.history-walk.test.ts`, `binance.history-walk.properties.test.ts`, spec :357; Create `src/screens/forms/transaction-form/row-labels/row-labels.test.ts`
- Create: `binance.history-paging.ts` + `.test.ts`, `binance.transfer-history.ts`, `binance.transfer-history.test.ts`, `binance.transfer-history.real-sqlite.test.ts`
- Modify: `binance.history-walk.ts` + `.test.ts` (`series`, `callsOf`), `binance.history-records.ts` + `.test.ts` (`seriesOf`), `binance.history-client.ts` + `.test.ts` (M2: `gathered`, BTC-only strict parse), `binance.history-budget.ts` + `.test.ts` (transfer cap 80, OVERNIGHT 19), `holding-metadata.ts` + its test (Transfer keys, `series` on a point), `src/crypto-sync/disconnect/disconnect.test.ts`, `binance.history-walk.properties.test.ts` (Transfer lane), `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts` + `.test.ts`, `index.ts` (barrel)

**Interfaces:**
```ts
// holding-metadata.ts
export type BinancePendingRange = { start: number; end: number; kind?: 'point'; series?: string }; // series: on a point only, the read series of its record; a range with a series, or a blank series, is malformed
export const BINANCE_TRANSFER_HISTORY_CURSOR_FIELD = 'binanceTransferHistoryCursor'; // now exported
export const BINANCE_TRANSFER_RESCAN_CURSOR_FIELD = 'binanceTransferRescanCursor'; // in binanceWalkCursorFields
export const BINANCE_TRANSFER_PENDING_OVERLAP_FIELD = 'binanceTransferPendingOverlap'; // in binanceWalkPendingFields
export const BINANCE_TRANSFER_POINT_CURSOR_FIELD = 'binanceTransferPointCursor'; // in binanceWalkPointCursorFields

// binance.history-walk.ts
export type OwedWindow = WalkWindow & { series?: readonly string[] }; // absent = every series of the walk
WalkPlan.points: OwedWindow[]; // one window per start: the widest point there; series = the union at that start (absent if one has none)
planWalkPasses(input: { …; pending: OwedGround[] }); // m-4
runWalkPlan(input: { …; callsOf?: (window: OwedWindow) => number }); // default () => 1. Keeps: RESCAN_KEEP * callsOf(rescan[0]), POINT_KEEP * callsOf(points[0]); a window is entered only when canAfford(keep + callsOf(window) - 1)
readPendingMark(input: { …; knownSeries?: readonly string[] }); // a point whose series is not in it: the list is malformed (repaired as today)
WindowOutcome.returned: OwedGround[]; // m-1: the points of every record the window's spans returned
export const distinctGround: (ground: OwedGround[]) => OwedGround[]; // p-1: the one copy, records.ts imports it

// binance.history-records.ts
settleRecords(input: { …; seriesOf?: (record: Record) => string }); // the owed point and the returned point carry it

// binance.history-client.ts (M2)
TotalPage<Row> = HistoryPage<Row> & { total: number; gathered: number }; // gathered: every row of the page, any asset; rows: the BTC rows, strictly parsed; a row of another asset is counted and never parsed further

// binance.history-paging.ts (new; Transfer and Earn)
export type TotalPaged<Row> = { kind: 'rows'; rows: Row[] } | { kind: 'split'; half: WalkWindow } | { kind: 'drift' };
export const fetchAllByTotal: <Row>(input: { run: BinanceHistoryRun; lane: BudgetLane; cost: CallCost; keep: number; half: WalkWindow | undefined; maxPages: number; fetchPage: (current: number) => Promise<TotalPage<Row>> }) => Promise<TotalPaged<Row> | undefined>; // undefined: budget
export type SeriesSpan<Series, Row> = { read: { series: Series; rows: Row[] }[]; drifted: Series[] };
export const readSeriesSpan: <Series extends string, Row>(input: { run; lane; cost; span: WalkWindow; keep: number; series: readonly Series[]; maxPages: number; fetchPage: (series: Series, span: WalkWindow, current: number) => Promise<TotalPage<Row>>; onRateLimit: (error: BinanceRateLimitError) => void }) => Promise<SpanRead<SeriesSpan<Series, Row>> | undefined>;

// binance.transfer-history.ts
export const TRANSFER_WINDOW_MS = 30 * DAY_MS;
export const transferFloorMs: (now: number) => number; // now - 6 calendar months (UTC) + 1 day
export const TRANSFER_SETTLED_STATUS = 'CONFIRMED';
export const transferRowsOf: (accountId: string, record: BinanceUniversalTransfer, readAs: UniversalTransferType) => PlannedTransferRow[]; // throws BinanceWalkStop (per-record codes)
export type BinanceHistoryRow = BinanceTransactionRow & { exchangeCounterpartHoldingId?: string; exchangePairId?: string; untrackedCounterpart?: string };
export const syncBinanceTransferHistory: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?: Partial<BinanceTransferHistoryDeps>) => Promise<WalkResult>;
// deps: now, readCredentials, listHoldings, fetchUniversalTransfers, ensureHoldings, addTransactions, writeWalkCursor, writeWalkPending
```

**Walk state (spec section 5):**

| State | Rule |
|---|---|
| Floor, window | `transferFloorMs(now)`; 30-day windows; `MAX_WINDOWS` 12; overlap `RESYNC_OVERLAP_MS` (1 day) |
| Passes | forward from `max(floor, cursor ?? floor)` to `now`; owed ranges outside the re-scan; re-scan `[base, forward start)`, `base = max(floor, min(now - 30 days, forward start - 1 day))`; owed points last (`startingAfter`) |
| Span read | `readSeriesSpan` over `UNIVERSAL_TRANSFER_TYPES`, `MAIN_FUNDING` and `FUNDING_MAIN` first (the likely dense types split the span before the other 18 are paid for). A span is entered only when `canAfford(keep + types - 1)`, so no span is paid for in part by the cap |
| Page rule (`fetchAllByTotal`) | A full page (`gathered` = 100) with `total` above the count so far: in a span that halves, the half (every type is read again in it); in a 1 ms span, the next `current`, at most 50 pages. `drift` for that type: a short page whose running count is not `total`, a count above `total`, or 50 pages short of `total`. M3: `{ total: N > 0 }` with no rows is a short page of 0, so it is `drift` |
| Record | series = the type it was read under; time = `timestamp` (ms; filter field, precision and range ends: VERIFY 12, 14) |
| Per-record stops (owe the point) | `transfer-not-settled` (status not `CONFIRMED`, T5), `transfer-id-missing` (blank `tranId`), `transfer-amount-invalid` (`btcSatoshis` null or at most 0), `transfer-type-mismatch` (the row's `type` is not the type read) |
| Owed point | `{ start: timestamp - 1, end: timestamp + 1, kind: 'point', series: <type> }`, never cut to the span |
| Span stops (owe the span as a range, every type) | `transfer-page-drift` (the types that did not drift still commit), `transfer-holding-missing`; a record whose `timestamp` lies outside the span |
| Forward pass | any code: the span stays uncommitted and the forward pass ends; the cursor never passes the record (A2); the run goes on to the owed ranges, the re-scan and the points (R28, OVERNIGHT 17) |
| Point read | the window's own series only: one call (one per type when points of different types start together: the widest window, the union of the types) |
| Rows | key `` `${accountId}:xfer:${type}:${tranId}:${holdingKey}` ``, pair id `` `${accountId}:xfer:${type}:${tranId}` `` (the type in the key: a `tranId` shared by two types can never refresh the other's row, so this needs no probe). `MAIN_FUNDING`: Spot -x, Funding +x; `FUNDING_MAIN`: the reverse; each leg's `exchangeCounterpartHoldingId` is the other leg's holding; `description: ''`. Untracked type: one leg on Spot (`MAIN`) or Funding (`FUNDING`), `untrackedCounterpart: untrackedWalletCode(other)`, negative when the tracked wallet is the source, `description: ''`. Category null. P7 through `resolveWalletHoldings` |
| Budget | lane `transfer`, `COSTS.transfer`, cap 80 (OVERNIGHT 19); `callsOf(window) = window.series?.length ?? 20`; `canAfford(keep) && !isBinanceCoolingDown`; a 429 sets the cooldown and ends every later read |
| Metadata (Spot holding) | `binanceTransferHistoryCursor`, `binanceTransferRescanCursor`, `binanceTransferPendingOverlap` (`knownSeries` = the 20 types; malformed: owe `[floor, cursor ?? floor)` once, `pending-malformed`), `binanceTransferPointCursor` (malformed: repaired, `point-cursor-malformed`). A balance sync carries all four; a disconnect resets the cursors to 2017 and the list to `[]` and drops the point cursor (existing paths, through the field arrays) |
| Write order | forward: the list with the overlap day, then the cursor. Other passes: rows, then one list write, then (re-scan) the mark, then (points) the point cursor |

Budget arithmetic (pinned by the Transfer property lane): a caught-up run spends forward 20 + one owed range 20 (entered with keep 21) + re-scan 20 + points up to 20 = 80. At cap 60 an owed range is never entered while a point is owed (20 + 21 + 19 = 60), so it starves: the reason for OVERNIGHT 19.

- **M2, from task 1/7 review:** decided above: the client reads `asset` first, parses only BTC rows strictly, and counts every row in `gathered` for the pager. Pinned in step 2/11.
- **M3, from task 1/7 review:** decided above: `{ total: N > 0 }` with no rows is `drift` in `fetchAllByTotal` (the client keeps `rows: []`). Pinned in step 2/11.
- **January 2027 Funding -> Spot auto-migration** (announcement https://www.binance.com/en/support/announcement/detail/01cbe42ead1e4f1a9382363754d2eb5a, checked 2026-10-11): how does the move appear in the transfer history (`FUNDING_MAIN`, another type, or not at all)? If `FUNDING_MAIN`, T2 imports it as paired legs with no change. If not at all, the Funding and Spot holding histories stop adding up to their balances. The import is decided before the migration starts: VERIFY 16 (spec), open for the user (Still needing the user).

- [ ] **step 1/11: deferred minors from task 4/7 (the FIRST commit of this task).** Ruling: task4-review-fix13.md (orchestrator decision 06:23) and task4-review-merge.md. Cost if wrong: none extra, every file is already in this task's mutation window.
  - m-1 (`binance.history-walk.ts` `withoutReadGround`, `runWalkPlan`): completion-gated drop. When a window of the pending pass, the re-scan or the points completes, ONE list write drops each listed point that the window holds whole and that equals a point in `WindowOutcome.returned`. A span that holds part of a point never drops it ("seen in any part" is wrong: it breaks the twin case). Tests, RED against TASK5_BASE: a point whose window comes back full, its record in the second half: it leaves once the window completes; the same window cut by the budget after the first half: it stays; two points that start together, the wider read, only the narrower's record returned: only the narrower leaves.
  - m-2 (`binance.history-walk.properties.test.ts`): the `mismatch` reading also applies to range and re-scan reads for a record whose point is listed (the read returns its trusted neighbours, never the stuck record). The held-by-range-drop and end-drop mutants must fail the PROPERTY file (they were 0 of 1850).
  - m-3 (spec :357): "A point costs exactly one read a run" -> "A point costs at most one window a run (a full window is read in halves)".
  - m-4: `planWalkPasses` `pending: OwedGround[]`.
  - p-1: one `distinctGround` (exported from `binance.history-walk.ts`, imported by `binance.history-records.ts`; `distinctPoints` is it plus the sort).
  - p-2: drop the sort at the end of `pointsToRead` (its input is sorted by start).
  - `holding-metadata.ts:327-328`: the comment says the caller goes on with an empty list; it is `readPendingMark`'s repair (owe `[floor, cursor)` once, stored at once).
  - LOW (task4-review-merge.md, `row-labels.ts:101`, `:109`): `row-labels.test.ts`: a leg `{ holdingId: 'h-card', amountMinorUnits: -700, exchangeCounterpartHoldingId: 'h-uah' }` with both holdings in UAH, description cleared: the placeholder reads 'Transfer to Wallet UAH'. Check by hand that the mutants `holdingId: ''` and no `holdingCurrencyById` fail it.
  - Check: `npx jest src/crypto-sync/binance/binance.history-walk src/crypto-sync/binance/binance.history-records src/holdings/holding-metadata src/screens/forms/transaction-form`, `npx tsc --noEmit`. Commit `fix(binance): deferred task 4/7 minors (completion-gated point drop, mismatch on every read, one distinctGround)`.
- [ ] **step 2/11:** Write the failing tests of the shared extensions:
  - `holding-metadata` test: a point with `series` round-trips; a range with `series`, a blank `series`, or a non-string `series` is malformed; the four Transfer keys are carried by `withWalkOwnedMetadataCarried` and reset by `withWalkOwnedMetadataResetToFloor` (point cursor dropped). `disconnect.test.ts`: a Spot holding with the four Transfer keys -> cursors 2017, list `[]`, no point cursor.
  - `binance.history-walk.test.ts`: `sameGround` tells two points apart by `series`; `pointsToRead` gives one window per start with the union of the series; `readPendingMark` with `knownSeries`: an unknown series repairs the list and logs `pending-malformed`; `runWalkPlan` with `callsOf` 20: the pending window is not entered when `keep + 19` calls do not fit, the re-scan keeps 20 calls, a point window with one series needs one call.
  - `binance.history-records.test.ts`: `seriesOf` reaches the owed point and the returned point; without it neither has a series (Pay and capital unchanged).
  - `binance.history-paging.test.ts`, one `it` per row: full page + `total` above it + a span that halves -> `split`; a 1 ms span -> pages `current` 1..n until the count is `total`; a short page with the count equal to `total` -> `rows`; short page, count not `total` -> `drift`; `{ total: 5 }` with no rows -> `drift` (M3); count above `total` -> `drift`; 50 pages short -> `drift`; unaffordable before page 2 -> `undefined`. `readSeriesSpan`: not entered when `keep + series - 1` calls do not fit (zero requests); a split on the third type returns the half; a `drift` on one type returns the rows of the others and names the drifted type; a 429 calls `onRateLimit` and returns `undefined`.
  - `binance.history-client.test.ts` (M2): a transfer page with a non-BTC row that lacks every field parses (`gathered` counts it, `rows` leaves it out); a malformed BTC row still throws `BINANCE_HISTORY_PARSE_ERROR`; the same for an Earn page.
  - `binance.history-budget.test.ts`: transfer cap 80 (80th call allowed, 81st not).
- [ ] **step 3/11:** Run `npx jest src/crypto-sync/binance src/holdings src/crypto-sync/disconnect`. Expected: FAIL (missing module, missing keys, `series` dropped).
- [ ] **step 4/11:** Implement the shared extensions (`holding-metadata.ts`, `binance.history-walk.ts`, `binance.history-records.ts`, `binance.history-paging.ts`, `binance.history-client.ts`, `binance.history-budget.ts`). Run the step 3/11 command. Expected: PASS, and the Pay and capital suites unchanged.
- [ ] **step 5/11:** Write the failing Transfer walk tests (`binance.transfer-history.test.ts`):
  - T1-T7 and T8-T10 from the spec matrix, one `it` each (T1: Spot -x and Funding +x, each counterpart the other holding, one pair id, then `exchangeExcludedTransactionIds` on the written rows returns both ids and `transactionRowDescription` gives "Transfer to/from"); each of the 18 untracked types maps to the right tracked holding, sign and code (table-driven).
  - Paging: a type whose first page is full halves the span and every type is read again in the half; a 1 ms span pages to `total`; a `drift` on one type in the re-scan commits the other 19 and owes the span as a range; M3 and M2 through the walk.
  - A point read requests only its own `type` (assert the request's `type` param, one call).
  - Floor and Review Focus 3 (cursor 2017 -> first `startTime` = `transferFloorMs(now)`); no request before the floor in any pass.
  - Budget: cap 80; a span is not entered when its 20 calls plus the keep do not fit; 429 -> cooldown, no later request; cooldown active -> zero requests.
  - Order: rows, then the list, then the re-scan mark (spy order); a stop logs only a `BinanceWalkStop` code (spy on `console.warn`: no amount, id or tranId).
  - `binance.transfer-history.real-sqlite.test.ts`: Review Focus 5 (two accounts, same `tranId` -> four rows, two pair ids); a second identical run imports 0; a PENDING transfer owed as a point imports once CONFIRMED and leaves the list.
  - `run-crypto-sync.test.ts`: order capital -> Pay -> Transfer with the SAME `run`; a Transfer failure is logged with `'[binance sync] transfer history failed'` and the balance result returns; a Pay 429 -> the Transfer walk makes no request.
- [ ] **step 6/11:** Add the Transfer lane to `binance.history-walk.properties.test.ts`. `Lane` gains `rangeCalls` (Pay and capital 1, Transfer `UNIVERSAL_TRANSFER_TYPES.length`) and `series` (Transfer: records over at least 3 types); `reads` = `LANE_CALL_CAPS.transfer`. The simulator charges a forward, range or re-scan read `rangeCalls` calls and a point read one call per series. P1-P6 and SL, each under the three end readings (both ends included, start left out, end left out); P4 reads: the re-scan reads and commits in every run whose forward pass leaves `rangeCalls + 1` calls. New families: (a) an owed range outside the re-scan window while points are owed: read within its bound; (b) a drifted type in the re-scan: the other types' records import in the same run, its own on a later read; (c) two stuck transfers of different types at the same millisecond: two points, each leaves only for its own record. Each test names its bound in runs, derived from calls.
- [ ] **step 7/11:** Run `npx jest src/crypto-sync/binance/binance.transfer-history src/crypto-sync/binance/binance.history-walk.properties`. Expected: FAIL (module missing).
- [ ] **step 8/11:** Implement `binance.transfer-history.ts` (pure `transferRowsOf` first, then the walk on the shared passes). Wire `run-crypto-sync.ts` after the Pay walk: `await logOnFailure('[binance sync] transfer history failed', () => syncBinanceTransferHistory({ targetAccountId, run }))`. Export from the barrel.
- [ ] **step 9/11:** Run `npx jest src/crypto-sync src/holdings src/statistics src/transactions src/screens/forms`, then `npx tsc --noEmit`. Expected: PASS. Commit `feat(binance): universal transfer walk on the shared per-record walk (typed owed points, paged by total)`.
- [ ] **step 10/11:** Named mutants. Apply each by Edit, run `npx jest src/crypto-sync/binance/binance.history-walk.properties.test.ts`, record "mutant: failing tests / total", revert by Edit (never git checkout or restore). Every mutant must fail the PROPERTY file:
  1. `callsOf` left out of the keeps (keeps of 1 call): the Transfer re-scan starves (P4).
  2. no entry pre-check (`keep + callsOf(window) - 1`): spans paid in part, bounds broken.
  3. `series` dropped when a point is stored: a point read costs 20 calls (P3, P5).
  4. `series` left out of `sameGround`: one record takes the other type's twin point off (P2, family c).
  5. `pointsToRead` keeps the widest point's series, not the union: the other type's point is never read (P5).
  6. a drifted type read out of the list like a clean page: its records never import (P1, family b).
  7. the point owed under the first type of the list, not the record's own (P2, P5).
  8. `LANE_CALL_CAPS.transfer` 60: the owed range starves while a point is owed (family a).
  9. m-1: a drop on "seen in any part", and no completion-gated drop.
  10. m-2: held-by-range drop, end-drop.
  11. forward commit on a stop (`commitSettledSpan` `stopsRun` false): P6.
  12. the task 4/7 set, now on every lane including Transfer: no `holdsAll`, no returned check, any record returned, narrowest at start, cursor only on complete, `POINT_KEEP` 0, length-based `isPoint`, point cut to the span, R28 reverted, no round-robin.
- [ ] **step 11/11:** Pre-BATCH-READY commands; `kiko:reviewer` on TASK5_BASE..tip (brief, top question first: can any trusted transfer row be dropped, doubled or starved, on every lane, under all three end readings, with a stop, a disconnect, the floor, a crash between any two writes? Then: the cap arithmetic; the typed point and the union window; M2/M3; the step 1/11 minors; the mutant table of step 10/11). BATCH READY names the mutant table.

### binance-history task 6/7: Earn walk, caption over every walk (developer)

**Shared walk: yes**, as the Transfer walk: the six record kinds are the series, read through `readSeriesSpan` and `fetchAllByTotal` (task 5/7); `callsOf(window) = window.series?.length ?? 6`; an owed point carries its kind. No shared file changes. One Earn rule: a reward GROUP is one record for `settleRecords`, because its rows are numbered within it.

**Files:**
- Create: `binance.earn-history.ts`, `binance.earn-history.test.ts`, `binance.earn-history.rewards.test.ts`, `binance.earn-history.real-sqlite.test.ts`
- Modify: `holding-metadata.ts` + its test (Earn keys), `src/crypto-sync/disconnect/disconnect.test.ts`, `binance.history-walk.properties.test.ts` (Earn lane), `run-crypto-sync.ts` + test, `index.ts` (barrel)
- Modify: `src/screens/account-detail/crypto-sync-section/binance-history-status.ts` + test, `crypto-sync-section.component.tsx` + its test
- Modify: `src/i18n/locales/en.ts`, `uk.ts` (`accountDetail.binanceHistoryPending`)

**Interfaces:**
```ts
export const EARN_WINDOW_MS = 30 * DAY_MS;
export const EARN_FLOOR_MS = Date.UTC(2022, 0, 1);
export const EARN_SETTLED_STATUS = 'SUCCESS'; export const EARN_FAILED_STATUSES: readonly string[] = ['FAILED'];
export const EARN_SERIES: readonly EarnRecordKind[]; // flexibleRewards, lockedRewards, then the four subscription and redemption kinds
export const subscriptionRowsOf / redemptionRowsOf: (accountId: string, kind: 'flexible' | 'locked', record) => PlannedEarnRow[]; // [] for FAILED; throws BinanceWalkStop
export type EarnRewardGroup = { kind: 'flexible' | 'locked'; ownerId: string; type: string; time: number; records: EarnReward[] };
export const rewardGroupsOf: (kind: 'flexible' | 'locked', records: EarnReward[]) => EarnRewardGroup[]; // by (kind, projectId | positionId, type, time)
export const rewardGroupRowsOf: (accountId: string, group: EarnRewardGroup) => PlannedEarnRow[]; // satoshis ascending, n from 0; throws BinanceWalkStop
export const syncBinanceEarnHistory: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?: Partial<BinanceEarnHistoryDeps>) => Promise<WalkResult>;
// holding-metadata.ts
export const BINANCE_EARN_HISTORY_CURSOR_FIELD = 'binanceEarnHistoryCursor'; // now exported
export const BINANCE_EARN_RESCAN_CURSOR_FIELD = 'binanceEarnRescanCursor';
export const BINANCE_EARN_PENDING_OVERLAP_FIELD = 'binanceEarnPendingOverlap';
export const BINANCE_EARN_POINT_CURSOR_FIELD = 'binanceEarnPointCursor';
// binance-history-status.ts
export const walkCursorsOf: (holdings: Pick<HoldingRow, 'metadata'>[]) => (number | null)[]; // the four forward cursors of the holding that carries the capital cursor; four nulls if none
export const owesPointsOf: (holdings: Pick<HoldingRow, 'metadata'>[]) => boolean; // any of the four lists on that holding holds a point (OVERNIGHT 20)
export const isBinanceHistoryBehind: (input: { cursors: readonly (number | null)[]; owesPoints: boolean; lastBalanceSyncAt: number | null }) => boolean; // any null cursor, any lag > DAY_MS, or a point owed; false before the first balance sync
```

**Walk state (spec section 6):**

| State | Rule |
|---|---|
| Floor, window | `EARN_FLOOR_MS`; 30-day windows (the S5 cap); `MAX_WINDOWS` 12; overlap 1 day |
| Span read | `readSeriesSpan` over `EARN_SERIES`, `asset=BTC`, flexible rewards `type=ALL`; entered only when `canAfford(keep + 5)`; page rule as Transfer; `drift` is `earn-page-drift` (E13) for that kind |
| Record | series = its kind; time = `time` (ms; filter field, precision and range ends: VERIFY 12, 15). A reward group (kind, `projectId` or `positionId`, `type`, `time`) is ONE record: its members share one time, so a read that returns one returns all of them (rests on VERIFY 15: the filter field is `time`) |
| Per-record stops (owe the point) | `earn-not-settled` (status neither `SUCCESS` nor `FAILED`, E14), `earn-split-mismatch` (E3), `earn-amount-invalid` (E12 amount; in a group, the whole group), `earn-id-missing` (blank `purchaseId`, `redeemId`, `projectId` or `positionId`), `earn-account-unknown` (`sourceAccount` or `destAccount` neither SPOT nor FUNDING), `earn-reward-type-unknown` (E17, the group) |
| Owed point | `{ start: time - 1, end: time + 1, kind: 'point', series: <kind> }`; one point per group |
| Span stops (owe the span as a range, every kind) | `earn-page-drift`, `earn-holding-missing`; a record whose `time` lies outside the span |
| No time | a BTC row with no finite `time` fails the client's strict parse (`BINANCE_HISTORY_PARSE_ERROR`): the walk's run fails and is logged (E12 time) |
| Forward pass, point read, write order | as Transfer |
| Rows | keys per OVERNIGHT 11; rewards: description `'Binance Earn'`, no markers, placement ruling A (flexible `REALTIME` -> Earn, flexible `BONUS` -> Spot, locked -> Spot); P7 through `resolveWalletHoldings` |
| Budget | lane `earn`, `COSTS.earn` (IP 150), cap 30 (4500 IP). A caught-up run: forward 6 + owed range 6 (entered with keep 7) + re-scan 6 + points up to 12 = 30 |
| Metadata (Spot holding) | the four Earn keys, `knownSeries` = `EARN_SERIES`; carry, reset and repair as Transfer |

- **M3, from task 1/7 review:** handled by `fetchAllByTotal` (task 5/7); pinned again through the Earn walk in step 1/10.

- [ ] **step 1/10:** Write the failing tests (`binance.earn-history.test.ts`, `binance.earn-history.rewards.test.ts`): E1-E22 from the spec matrix, one `it` each (E2: three legs, one pair id, Spot and Funding counterparts = Earn, Earn counterpart = Spot (the larger leg; tie -> Spot); E4 `sourceAccount: 'FUNDING'`; E7 REALTIME -> Earn; E15 BONUS -> Spot; E16 locked -> Spot; E17 -> the group owes its point, forward pass: cursor unmoved; E18 / P7: Spot created at 0); a `FAILED` subscription is ignored and owes nothing; a point read requests only its own kind (one call); floor 2022-01-01 and the 2017 reset (Review Focus 3); cap 30 and IP reading 5851 -> unaffordable; 429 -> cooldown; rows before the list before the mark. `binance.earn-history.real-sqlite.test.ts`: Review Focus 4 (a group grows on a re-read -> two rows, total 3 sat); E10/E11 idempotence; a stuck reward group imports once its type is known and leaves the list. `holding-metadata` and `disconnect` tests: the four Earn keys carried, reset, the point cursor dropped. `run-crypto-sync.test.ts`: the full order capital -> Pay -> Transfer -> Earn with one shared `run`; each walk's failure isolated (`'[binance sync] earn history failed'`); a 429 in Transfer -> Earn makes no request.
- [ ] **step 2/10:** Write the failing caption tests: `isBinanceHistoryBehind` true for any null cursor, any lag > 1 day, or a point owed on any list (OVERNIGHT 20); false when all four cursors are within a day and no point is owed; false before the first balance sync; `walkCursorsOf` reads the Spot holding's four forward cursors; `owesPointsOf` reads its four lists (a range alone is not a point: the overlap day is always there); the section shows `binanceHistoryPending` when only the Earn cursor is behind, and when only a Transfer point is owed.
- [ ] **step 3/10:** Add the Earn lane to `binance.history-walk.properties.test.ts`: `reads` = `LANE_CALL_CAPS.earn`, `rangeCalls` 6, series = the six kinds; a stuck record may be a reward group of 1 to 3 members at one millisecond. P1-P6 and SL under the three end readings, and families (a)-(c) of task 5/7 step 6/11 on this lane.
- [ ] **step 4/10:** Run `npx jest src/crypto-sync/binance/binance.earn-history src/crypto-sync/binance/binance.history-walk.properties src/screens/account-detail src/holdings`. Expected: FAIL.
- [ ] **step 5/10:** Implement `binance.earn-history.ts` (pure row and group functions first, then the walk) and the four Earn keys.
- [ ] **step 6/10:** Wire after the Transfer walk with `logOnFailure('[binance sync] earn history failed', …)`. Export from the barrel.
- [ ] **step 7/10:** Implement the caption change; update `binanceHistoryPending` copy: en "Some Binance transaction history is not imported yet. Kiko will keep importing on each sync." uk "Частину історії транзакцій Binance ще не імпортовано. Кіко продовжить імпорт під час наступних синхронізацій."
- [ ] **step 8/10:** Run `npx jest src/crypto-sync src/holdings src/screens/account-detail src/i18n`, then `npx tsc --noEmit`. Expected: PASS. Commit `feat(binance): Simple Earn walk on the shared per-record walk (reward groups); history caption covers every walk and owed points`.
- [ ] **step 9/10:** Named mutants, as task 5/7 step 10/11, on the Earn lane: `callsOf` left out of the keeps; `series` dropped from the stored point; the point owed under the first kind, not the record's own; a drifted kind read out of the list; forward commit on a stop; R28 reverted; no round-robin; a reward group settled per member (a member's stop owes its point and the other members commit: their `n` shifts, so a later read writes a second row for the same reward; killed by `binance.earn-history.rewards.test.ts`, recorded beside the property mutants).
- [ ] **step 10/10:** Pre-BATCH-READY commands; `kiko:reviewer` on TASK6_BASE..tip (brief, top question first: can any trusted Earn row be dropped, doubled or starved, a reward group numbered two ways, or a row placed on the wrong wallet? Then: the caption with points; the mutant table). BATCH READY lists the changed en/uk key for translator review and the mutant table.

### binance-history task 7/7: VERIFY gate, skill rewrite, whole-branch gate (developer, scribe, reviewer)

**Files:**
- Create (gitignored, main checkout): `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/binance-history-verify.sh`
- Output (user run): `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/binance-history-verify-output-<date>.txt`
- Modify (scribe): `.claude/skills/kiko-architecture/SKILL.md` "Binance transaction history" (rewrite), plus `harness/kiko/skills/` / `harness/kiko/agents/` drift found by retrospect

The probe needs no app code: dispatch steps 1/7-3/7 right after task 1/7 lands, in parallel with tasks 2-6, so Q answers reach tasks 4-6 before their review.

- probe: can a Pay order appear with transactionTime more than 1 day behind the newest order (refund, merchant, lag)? (The Pay walk's forward pass starts at the cursor; the stored re-scan covers the 89 days behind it, and the overlap day behind the cursor even after a long absence, so a late order is caught only when the re-scan has run since it settled.)
- probe: January 2027 Funding -> Spot auto-migration (Binance announcement, checked 2026-10-11): how does the move appear in the transfer history (`FUNDING_MAIN`, another type, or not at all)? If not at all, the Funding and Spot holding histories stop adding up to their balances; decide the import before the migration starts.
- probe: sign of fundsDetail amounts on a send. The B5 rule sums the BTC funds entries and compares them with `abs(amount)`; if Binance signs the funds of a send negative, no B5 order matches and every one stops (`pay-split-mismatch`). Print the sign (positive, negative, zero) of each `fundsDetail[].amount` of a send, with the sign of its `amount`.
- probe: any send with an empty fundsDetail. B7 stops such a send (`pay-split-mismatch`) instead of placing it whole. Print the count of sends whose `fundsDetail` is empty, with the currency and the wallet fields of each (names and types only, never an amount), to see whether a real order lands there.
- probe: receive from a Spot payer: `walletTypes` and `walletAssetCost` keys. (Ruling R22 replaces R21: a Pay receive is placed by date, Funding before 2026-09-29T00:00:00Z and Spot from it, and reads no wallet field, because a receive's wallet fields may describe the payer; the probe saw only Funding receives. Print, for a receive, `walletTypes` and the keys of `walletAssetCost` against the user's own wallets and its date, so the date rule can be confirmed or changed. Also: for a send, how often a named wallet has no cost above zero, the case the subset rule places on the costed wallet only.)
- probe: range end semantics, for each endpoint the walk reads (Pay transactions, capital deposit, capital withdraw, transfer, Earn): whether `startTime` is included and whether `endTime` is included. Read `[t, t]`, `[t - 1, t]` and `[t, t + 1]` around a known record time `t` and print which of them return the record.
- probe: withdraw history: which field `startTime` and `endTime` filter on (`applyTime`, `completeTime`, or another), and whether `applyTime` is truncated or rounded to the second against that field. The owed point of a withdrawal (`[T - 1000, T + 1000]`) rests on this.
- probe (spec VERIFY 14): universal transfer: which field `startTime`/`endTime` filter on (`timestamp`?), the precision of `timestamp`, the range ends (item 12) on a transfer row of ANY asset, whether a `tranId` repeats across types, the status values (Q11), and the answer to a `startTime` older than 6 months. The probe account had 0 transfer rows: the user makes one small Spot -> Funding transfer of any coin first, or the item stays open (the walk holds under every end reading; a wrong filter field only keeps a point owed, fail closed).
- probe (spec VERIFY 15): Simple Earn, per kind: the filter field (`time`?), its precision, the range ends (item 12), and whether every member of a reward group (kind, project or position id, `type`, `time`) comes back in any read that returns one of them. The reward key `<time>:<n>` rests on this. The probe account had 0 Earn rows: the user subscribes and redeems a small flexible amount of any coin first, or the item stays open.
- probe (spec VERIFY 16, after the January 2027 migration, not before the merge): on an account that held Funding BTC, the transfer rows of every type on the migration day; before the migration, `kiko:researcher` reads Binance's migration notes for how it is recorded (URL + date).

- [ ] **step 1/7:** Developer writes `binance-history-verify.sh` on the `eodhd-verify.sh` pattern: `set -u`; hidden `read -rs` for key and secret; HMAC via `openssl dgst -sha256 -hmac` reading the query from stdin; curl `--config -` (key header and URL never in argv); masked URLs in output; prints only HTTP status, `code`, counts, field names and JSON types, never a raw body, id, amount, name or uid. It covers spec probe items 1-15 (a second run for items 12-15, which came after the first run), each under a numbered heading. Item 10 includes the count of reward `type` values per kind (before the merge, Q14) and the maturity-paid question (do locked reward rows exist that pay at maturity to the redeem destination, for example locked reward rows compared with locked positions and redemptions with `redeemTo` FLEXIBLE). Read-only endpoints only. Weight-safe: sleeps 400 ms between calls; stops on 429/418 and prints the item reached.
- [ ] **step 2/7:** The planner (or a fresh `kiko:reviewer`) reads the WHOLE script before it goes to the user: no secret echo, no `set -x`, no body dump, no write endpoint, every `curl` through `--config -`, heredocs quoted.
- [ ] **step 3/7:** The coordinator sends the user the run command and the output path. The user runs it and returns the output.
- [ ] **step 4/7:** The orchestrator maps every output item to Q1-Q16 and A1 (answered / safe default holds / rule change). Done 2026-10-10: the spec's Q table has an "Answer" column (A1, Q1-Q9 and Q15 answered; Q10-Q14 and Q16 "no data in the probe account, rule unchanged"); the rule changes were R13 (direction from the uid), C1 (guard and cap removed, Q5), I5 = A2 (Q8), R14 (capital two-pass), and the Q9 text wallet ids. A rule change updates the spec first, then gets its own fix task (renumber M). Before merge, the coordinator reports the Q14 probe counts (ruling A is made; the user may still check one BONUS or locked reward in the Binance app) and, if item 10 found identical reward records, Q16. Item 4's walletType-1 count > 0 opens the D3 follow-up (move old rows, with its own `kiko:reviewer`).
- [ ] **step 5/7:** `kiko:retrospect` on the branch, then `kiko:scribe` rewrites kiko-architecture "Binance transaction history" (four walks, shared run budget and caps, walk cursors, P7 insert-only ensure, placement by walletType, pairing and `untracked_counterpart`, caption over every walk, capital rows' `'BTC'` description, Convert deferred and why) and commits.
- [ ] **step 6/7:** `bash scripts/wait-load.sh 8` (background), then `env -u FORCE_COLOR make verify` at the branch tip until exit 0 with the full test count. Whole-branch `kiko:reviewer` pass (compliance brief: kiko-compliance 5.1.1/5.1.5, `memory/refs/resubmission-kit.md` section D unchanged, no new host).
- [ ] **step 7/7:** Final report: every task's base sha, `make mutable` count and `make deep` result (the coordinator's runs), the drift-fix sha, the probe mapping, and the open user confirmations.

## OVERNIGHT, needs user confirmation

Safest defaults applied by the planner on 2026-10-10 while the user was away. Each one is applied in the plan as written; the user can reverse any of them before the task that owns it.

1. P7 creates a missing wallet holding with a new insert-only `ensureExchangeHoldings`, not `upsertExchangeMany` (the upsert would zero a live balance). Task 2/7.
2. The Pay walk reads `fetchAccount` once per run for the `uid` (`{ ip: 20 }` on the Pay lane). A non-429 failure, or an account with no uid, stops the walk before any request (`pay-uid-unavailable`, R13). Task 4/7.
3. SUPERSEDED (user ruling C1, 2026-10-10, after probe Q5): the Pay walk end is `now`, with no clamp to the capital cursor and no overlap guard. Task 4/7.
4. The Transfer walk reads 20 types (the 18 untracked plus `MAIN_FUNDING`, `FUNDING_MAIN`). A first walk is about 140 calls over 2 runs at the cap of 80 (item 19; 3 runs at 60). Task 5/7.
5. SUPERSEDED (R13, 2026-10-10, after probe Q3): the direction comes from the uid alone. A uid that matches neither Pay party, both parties, or nothing at all (unknown uid) stops the window. Task 4/7.
6. Untracked wallet display names (code-side proper nouns): 'USDⓈ-M Futures', 'COIN-M Futures', 'Margin', 'Options', 'Portfolio Margin'. Task 3/7.
7. The same-currency "Transfer to/from" label also applies to existing MANUAL same-currency Exchange legs, because the spec compares currencies generally. Task 3/7.
8. The uk `transferTo/From` strings take no «» quotes, the same as the existing `exchangeTo/From`. They go to translator review. Task 3/7.
9. RESOLVED (step 2/9 SDK facts): type optional; client sends type=ALL, one series. Tasks 1/7 and 6/7.
10. The migration takes number 0056. It is renumbered if build 29 lands a migration first. Task 3/7.
11. Earn key layout: `earn:sub:<flexible|locked>:<purchaseId>:<holdingKey>`, `earn:redeem:…`. The pair id is the same without the holding key. Task 6/7.
12. Earn statuses: only `SUCCESS` imports and `FAILED` is ignored. Any other status is a stop (owed at the record's point, item 18). Task 6/7.
13. Walk stops are logged as `logFailure(tag, new BinanceWalkStop(code))`, so only the name and the fixed code reach the log. Tasks 2/7-6/7.
14. The plan keeps the spec's 7 tasks. Task 3/7 mutates four large files, so its `make deep` is slow. The alternative is to split task 3/7 into "migration + exclusion" and "labels + callers", which renumbers the plan to 8 tasks.
15. The probe script (task 7/7, steps 1/7-3/7) is dispatched as soon as task 1/7 lands, in parallel with tasks 2-6.
16. B7 (fix round 8, orchestrator ruling B7): a Pay SEND with an empty `fundsDetail` stops (`pay-split-mismatch`) instead of being placed whole on the one wallet `walletTypes` names. B5 placement stays only for a send whose BTC funds entries, summed, equal `abs(amount)`, with no cost list and one `walletTypes` wallet. The user can reverse it before task 4/7 merges. Task 4/7.
17. OVERNIGHT DEFAULT, pending the user (fix round 11, ruling R28; it touches the scope of A2 as ruling A did, and is not part of the user ruling of 2026-10-11): a stop in the FORWARD pass ends only the forward pass, so the run goes on to the owed ranges, the re-scan and the points (the budget and a rate limit still end every read), and a settled record in an owed day imports however long the forward pass stays stopped. The cursor still never passes the stuck record (A2 unchanged). If the user reverses it, a forward stop ends the run again: one branch in `runWalkPlan`. Task 4/7.
18. NEEDS USER CONFIRMATION. Default applied: the Transfer and Earn walks follow the Pay rule of the user ruling of 2026-10-11 (option A): in the pending pass and the re-scan the other records of a span import, and only a record the walk cannot trust stays owed at its own point (a pending transfer, an Earn record not settled, a split mismatch, a reward of unknown type). The approved spec said the whole window stops ("the window commits only once every type is complete", T5, E3, E12-E14, E17). The forward pass keeps the stop (cursor unmoved, A2); whether the run then goes on is item 17, for every walk. Recommendation: confirm. Otherwise one pending transfer holds back 30 days of rows of all 20 types, and the shared walk needs a whole-window branch again. Tasks 5/7, 6/7.
19. NEEDS USER CONFIRMATION. Default applied: the Transfer lane cap goes from 60 to 80 calls a run. A caught-up run needs forward 20 + one owed range 20 + re-scan 20 + points; at 60 an owed range outside the re-scan is never read while a point is owed, so its records are never imported. Cost: the Transfer walk takes up to 80 x 350 ms = 28 s of a sync during a catch-up (was 21 s); a caught-up run reads about 41 calls (14 s) either way. A first walk takes 2 runs instead of 3. Recommendation: confirm (the alternative is a known data gap). Task 5/7.
20. NEEDS USER CONFIRMATION. Default applied: the history caption also shows while any walk owes a point (a record it could not import yet), not only when a cursor is more than a day behind. The spec promises the caption whenever a record is held back ("The caption shows that history is behind"); with owed points a held-back record no longer holds the cursor. Recommendation: confirm. If reversed, a stuck record found by the re-scan is invisible to the user until it imports. Task 6/7.
21. NEEDS USER CONFIRMATION. Default applied: the spec rule, a transfer whose status is not `CONFIRMED` is owed (Q11 unanswered). A transfer that ends `FAILED` then stays owed until the 6-month floor drops it: one call a round and, with item 20, the caption for up to 6 months. Recommendation: once the probe (VERIFY 14) shows the final failure value, ignore it as Earn ignores `FAILED` (item 12); no row imports either way. Task 5/7.

## Self-review

- Spec coverage: client (1/7), budget, caps, order, cooldown, cursors, generic writer, capital D3 (2/7), D5 column, exclusion, labels, back-compat (3/7), Pay (4/7), Transfer (5/7), Earn D6, caption and copy (6/7), probe and skill (7/7). Convert: no task (D7).
- Names used across tasks: `BinanceHistoryRun`, `createBinanceHistoryRun`, `WalkResult`, `BinanceWalkStop`, `resolveWalletHoldings`, `ensureExchangeHoldings`, `setBinanceWalkCursor`, `fetchAllByTotal`, `readSeriesSpan`, `OwedWindow`, `callsOf`, `distinctGround`, `BinanceHistoryRow`, `COSTS`, `untrackedWalletCode`.
- Tasks 5/7 and 6/7 run on the shared per-record walk of task 4/7; the deferred task 4/7 minors are task 5/7 step 1/11.
