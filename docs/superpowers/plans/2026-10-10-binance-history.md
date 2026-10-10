# Binance history (Pay, own-wallet transfers, Simple Earn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Binance movement that changes the Spot (`'BTC'`), Funding (`'BTC:funding'`) or Earn (`'BTC:earn'`) BTC holding becomes a transaction row on that holding. Convert is deferred (D7).

**Architecture:** One shared request gate and one `BinanceRunBudget` per Binance arm feed four walks in order (capital, Pay, Transfer, Earn). Each walk is its own file, its own watermark on the Spot holding's metadata, and its own `logOnFailure`. Movements between two tracked holdings are paired legs (`exchangeCounterpartHoldingId` + `exchangePairId`). A one-leg movement to an untracked wallet carries the new `transactions.untracked_counterpart` code (migration 0056). Labels are resolved at render time.

**Tech Stack:** React Native 0.87, op-sqlite + Drizzle, react-i18next, Jest/RNTL with `node:sqlite` (`@kiko/test-support/real-sqlite`), fnts, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-09-binance-pay-history-design.md` (rev 3, commit 7aa2aeaf, approved D1-D7). Read it with this plan; the matrix row ids (P1, T3, E8, ...) below refer to it.

**Track:** `binance-history`. Change sets are named "binance-history task N/7"; steps inside are "step N/M".

## Spec claims checked against the code (mismatches first)

1. **The newest Pay window would never commit.** Spec section 4: a Pay window commits only when its end is at or before `binanceHistoryCursor`. The capital walk writes `window.end = now` at ITS start, and the Pay walk's `now` is later, so the last Pay window is always past the cursor. The plan clamps the Pay walk's `endTime` to `min(now, capitalCursor)` (task 4/7). A null capital cursor means Pay does nothing that run (`complete: false`).
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

1. **The newest Pay window.** With capital fully caught up, a Pay run commits its last window and `binancePayHistoryCursor` equals the capital cursor; the next run's Pay start re-scans from that cursor minus the overlap. Pinned in task 4/7.
2. **An old capital row with walletType 1.** A deposit imported on Spot before task 2/7, seen again in the overlap window with `walletType: 1`, stays on Spot: no second row on Funding, and the row count stays the same. Pinned in task 2/7 (real SQLite).
3. **Disconnect, then reconnect.** Every walk cursor is reset to 2017. The Pay walk's first request starts at `max(HISTORY_FLOOR_MS, now - 18 months + 1 day)`, the Transfer walk's at `now - 6 months + 1 day`, the Earn walk's at 2022-01-01. No request asks for older data. Pinned in tasks 4/7, 5/7, 6/7.
4. **An Earn reward group grows on a re-read.** First read [0.00000002] gives `:0` = 2 sat. A re-read of [0.00000001, 0.00000002] gives `:0` = 1 sat (refreshed amount) and `:1` = 2 sat. Total 3 sat, two rows, no duplicate. Pinned in task 6/7 (real SQLite through `addManyDedup`).
5. **Two Binance connections with the same `tranId`.** Each account gets its own legs and its own pair id; no row of one account is refreshed by the other. Pinned in task 5/7.

---

## Mutation gate (per change set)

Each task is one change set. Its base is the commit it starts from: task 1/7's base is the merge commit of step 1/9; each later task's base is the previous task's tip. Before BATCH READY the orchestrator runs `KIKO_MUTATION_BASE=<task base> make mutable` and reports the count. The coordinator then runs `KIKO_MUTATION_BASE=<task base> make deep` detached. Never one whole-branch run. Tests, `index.ts`, `.d.ts`, locales and `.js` are excluded by the gate.

| Task | Expected mutable source files | Count |
|---|---|---|
| 1/7 | `binance.client.ts`, `binance.history-client.ts`, `binance.transactions.ts` | 3 |
| 2/7 | `binance.history-budget.ts`, `binance.history-walk.ts`, `binance.holding-keys.ts`, `binance.transactions.ts`, `binance.provider.ts`, `holding-metadata.ts`, `holdings.repo.ts`, `run-crypto-sync.ts` | 8 |
| 3/7 | `src/db/schema.ts` (counted, not scored), `transactions.repo.ts`, `exchange-exclusion.ts`, `category-breakdown.ts`, `statistics.screen.tsx`, `untracked-counterpart.ts`, `exchange-description.ts`, `row-description.ts`, `home.screen.tsx`, `transaction-row.component.tsx`, `holding-detail.screen.tsx`, `transaction-form.screen.tsx`, `example-transaction.component.tsx` | 13 |
| 4/7 | `binance.pay-history.ts`, `binance.history-walk.ts`, `run-crypto-sync.ts` | 3 |
| 5/7 | `binance.transfer-history.ts`, `binance.history-walk.ts`, `run-crypto-sync.ts` | 3 |
| 6/7 | `binance.earn-history.ts`, `run-crypto-sync.ts`, `binance-history-status.ts`, `crypto-sync-section.component.tsx` | 4 |
| 7/7 | none (probe script is gitignored; skill text only) | 0 |

All paths under `src/crypto-sync/binance/` unless shown otherwise. Slow runs to expect: task 3/7 mutates `transactions.repo.ts` (2,859 lines), `transaction-form.screen.tsx` (2,847), `statistics.screen.tsx` (1,307) and `holding-detail.screen.tsx` (1,299); task 2/7 mutates `holdings.repo.ts`. Stryker mutates whole files; quote the ETA from run history (`kiko:estimator`).

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
export const resolveWalkStart: (input: { cursor: number | null; floorMs: number; endTime: number; windowMs: number; overlapMs: number }) => number; // null -> floor; else max(floor, min(cursor - overlap, end - window))
export const btcSatoshis: (amount: unknown) => number | null; // decimal string or number -> Money.fromMajor('BTC'), null when not finite
export class BinanceWalkStop extends Error { constructor(code: string) } // name 'BinanceWalkStop', own `code` = the fixed tag; logged via logFailure
export const logWalkStop: (code: string) => void;
export const resolveWalletHoldings: (input: { accountId; keys: BinanceWalletKey[]; listHoldings; ensureHoldings }) => Promise<Map<BinanceWalletKey, HoldingRow>>; // P7: ensure missing keys at 0, then re-list
// HISTORY_FLOOR_MS stays exported from binance.transactions.ts (disconnect imports it)

// holding-metadata.ts
export const BINANCE_PAY_HISTORY_CURSOR_FIELD = 'binancePayHistoryCursor';
export const BINANCE_TRANSFER_HISTORY_CURSOR_FIELD = 'binanceTransferHistoryCursor';
export const BINANCE_EARN_HISTORY_CURSOR_FIELD = 'binanceEarnHistoryCursor';
export const binanceWalkCursorFields: readonly [capital, pay, transfer, earn]; export type BinanceWalkCursorField;
export const binanceWalkCursorOf: (field: BinanceWalkCursorField, metadata: unknown) => number | null;
// walkOwnedMetadataKeys = binanceWalkCursorFields

// holdings.repo.ts
setBinanceWalkCursor: (holdingId: string, field: BinanceWalkCursorField, cursorMs: number) => Promise<void>; // replaces setBinanceHistoryCursor; same institution = 'binance' gate
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
- Create: `binance.pay-history.ts`, `binance.pay-history.test.ts`, `binance.pay-history.direction.test.ts` (matrix), `binance.pay-history.real-sqlite.test.ts` (overlap guard + idempotence through the real repos)
- Modify: `binance.history-walk.ts` (only if a helper is shared with task 5/7; else untouched), `src/crypto-sync/run-crypto-sync/run-crypto-sync.ts` + test

**Interfaces:**
```ts
export const PAY_WINDOW_MS = 89 * DAY_MS;
export const PAY_OVERLAP_GUARD_MS = 10 * 60_000;
export const payFloorMs: (now: number) => number; // max(HISTORY_FLOOR_MS, now - 18 calendar months (UTC) + 1 day)
export type PayDirection = 'out' | 'in';
export const payDirection: (order: BinancePayOrder, uid: string | null) => PayDirection | null; // null = stop
export const payDescription: (order: BinancePayOrder, direction: PayDirection) => string; // trimmed counterparty name or 'Binance Pay'
export const syncBinancePayHistory: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?: Partial<BinancePayHistoryDeps>) => Promise<WalkResult>;
// deps: now, readCredentials, listHoldings, fetchAccount, fetchPayHistory, ensureHoldings, addTransactions, writeWalkCursor, listHoldingTransactions (transactionsRepo.listByHoldingQuery)
```
Rules (spec section 4): window end = `min(now, capitalCursor)`; no capital cursor -> `{ imported: 0, complete: false }`. Paging by narrowing `endTime` to the page's minimum `transactionTime`; a full page whose minimum is not below the current `endTime` stops (`pay-page-stuck`). Budget lane `pay`, cost `COSTS.pay`; the uid read costs `COSTS.account` on the same lane. Key `` `${accountId}:pay:${orderType}:${transactionId}:${walletType}` ``. Overlap guard: skip (log `pay-overlap-skip`) when a row on the target holding whose `externalId` starts with `${accountId}:deposit:` or `${accountId}:withdraw:` has the same signed satoshis and `|time diff| <= 10 min`. Category null. No markers.

- [ ] **step 1/7:** Write the failing tests. `binance.pay-history.direction.test.ts`, one `it` per spec "Pay direction" row 1-12, plus: (13) uid known but matching neither party, shape and sign agree -> per shape (signal 2 absent); (14) uid equal to both parties -> stop. Placement P1-P6 (`walletType` 2 Spot, 1 Funding, 5 Earn; `walletTypes [1,2]` with `walletAssetCost` summing to `abs(amount)` -> one row per wallet with its own key; sums differ -> stop; 3/4/6/unknown -> stop) and P7 (Earn missing -> created at 0). In `binance.pay-history.test.ts`: `currency !== 'BTC'` ignored; non-BTC order with a BTC `fundsDetail` entry -> not imported, `pay-non-btc-funds` logged once; empty `transactionId` -> stop; windows from `payFloorMs` (fake clock 2026-10-10 -> floor 2025-04-11); Review Focus 3 (cursor at 2017 -> first `startTime` equals the floor); re-sync start `min(cursor - DAY_MS, end - window)`; paging (a full page of 100 -> second call with `endTime` = page minimum; stuck page -> stop, cursor unmoved); Review Focus 1 (capital cursor = T, now = T + 5 s -> last window ends at T and commits, Pay cursor = T); capital cursor null -> no request; budget (`usedUidWeight1m` 177001 -> next call unaffordable -> `complete: false`, committed windows kept; cap 20); 429 -> cooldown set, `complete: false`; cooldown active -> zero requests; a rows-then-cursor order assertion (cursor write after `addTransactions`); a stop logs only a `BinanceWalkStop` code (spy on `console.warn`: no amount, id or name in the args). `binance.pay-history.real-sqlite.test.ts`: overlap guard skips a Pay row matching a committed capital deposit (same sats, 9 min apart) and keeps one 11 min apart; a second identical run imports 0 new rows. `run-crypto-sync.test.ts`: order capital -> Pay with the SAME `run` object; a Pay failure is logged (`'[binance sync] pay history failed'`) and the balance result returns; a capital 429 (cooldown set) -> the Pay walk makes no request.
- **M2, from task 1/7 review:** `fetchPayHistory` parses every coin's Pay rows strictly, so one off-contract non-BTC row stalls the BTC walk. Decide this first (for example read `currency` first and parse strictly only BTC rows, keeping the gathered count for the pager) and pin it with a test.
- [ ] **step 2/7:** Run `npx jest src/crypto-sync/binance/binance.pay-history`. Expected: FAIL (module missing).
- [ ] **step 3/7:** Implement `binance.pay-history.ts` (pure helpers first, then the walk). Read `payerInfo.binanceId` / `receiverInfo.binanceId` only for direction; never put them in a row or a log.
- [ ] **step 4/7:** Wire into `run-crypto-sync.ts` after the capital walk: `await logOnFailure('[binance sync] pay history failed', () => syncBinancePayHistory({ targetAccountId, run }))`. Export from the barrel.
- [ ] **step 5/7:** Run `npx jest src/crypto-sync`, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **step 6/7:** Commit `feat(binance): Pay history walk (direction, placement, nickname description)`.
- [ ] **step 7/7:** Pre-BATCH-READY commands; `kiko:reviewer` (brief: direction matrix vs spec; PII: only `name` stored, `binanceId` never leaves the function; logs fixed; Pay window end clamp). BATCH READY.

### binance-history task 5/7: Transfer walk (developer)

**Files:**
- Create: `binance.transfer-history.ts`, `binance.transfer-history.test.ts`, `binance.transfer-history.real-sqlite.test.ts`
- Modify: `binance.history-walk.ts` (a shared `fetchAllByTotal` pager if task 6/7 reuses it; jscpd otherwise flags the two loops), `run-crypto-sync.ts` + test

**Interfaces:**
```ts
export const TRANSFER_WINDOW_MS = 30 * DAY_MS;
export const transferFloorMs: (now: number) => number; // now - 6 calendar months (UTC) + 1 day
export const TRANSFER_SETTLED_STATUS = 'CONFIRMED';
export const transferLegs: (accountId: string, record: BinanceUniversalTransfer, holdings: Map<BinanceWalletKey, HoldingRow>) => BinanceHistoryRow[] | 'stop' | 'ignore';
export const syncBinanceTransferHistory: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?) => Promise<WalkResult>;
// binance.history-walk.ts
export const fetchAllByTotal: <Row>(input: { lane: BudgetLane; cost: CallCost; run: BinanceHistoryRun; fetchPage: (current: number) => Promise<TotalPage<Row>>; maxPages: number }) => Promise<{ kind: 'done'; rows: Row[]; total: number } | { kind: 'unaffordable' }>;
export type BinanceHistoryRow = BinanceTransactionRow & { exchangeCounterpartHoldingId?: string; exchangePairId?: string; untrackedCounterpart?: string };
```
Rules (spec section 5): per window, one series per type in `UNIVERSAL_TRANSFER_TYPES`, paged by `current` until gathered >= `total` or a short page; the window commits only when every type is complete. Lane `transfer`, cost `COSTS.transfer`. Leg key `` `${accountId}:xfer:${tranId}:${holdingKey}` ``, pair id `` `${accountId}:xfer:${tranId}` ``, paired legs `description: ''`. One-leg rows: `untrackedCounterpart: untrackedWalletCode(other)`, `description: ''`.

- [ ] **step 1/7:** Write the failing tests: T1-T7 from the spec (T1: Spot -x and Funding +x, each counterpart the other holding, one pair id, then `exchangeExcludedTransactionIds` on the written rows returns both ids and `transactionRowDescription` gives "Transfer to/from"); every one of the 18 untracked types maps to the right tracked holding, sign and code (table-driven); T5 `PENDING` -> stop, cursor unmoved; T6 non-BTC ignored; floor and Review Focus 3 (cursor 2017 -> first `startTime` = `transferFloorMs(now)`); one type's page unaffordable mid-window -> nothing of that window committed; cap 60; 429 -> cooldown; Review Focus 5 (two accounts, same `tranId` -> four rows, two pair ids; real SQLite); idempotent second run (real SQLite); `run-crypto-sync`: order capital -> Pay -> Transfer, failure isolated with tag `'[binance sync] transfer history failed'`.
- **M2, from task 1/7 review:** `fetchUniversalTransfers` parses every asset's transfer rows strictly, so one off-contract non-BTC row stalls the BTC walk. Decide this first (for example read `asset` first and parse strictly only BTC rows, keeping the gathered count for the pager) and pin it with a test.
- **M3, from task 1/7 review:** a body `{ total: N }` with no `rows` parses as `rows: []`. The pager (or the client) must treat absent rows with `total > 0` as a stop or a parse error. Pin it.
- [ ] **step 2/7:** Run `npx jest src/crypto-sync/binance/binance.transfer-history`. Expected: FAIL.
- [ ] **step 3/7:** Implement `fetchAllByTotal` and the walk.
- [ ] **step 4/7:** Wire after the Pay walk with its own `logOnFailure`. Export from the barrel.
- [ ] **step 5/7:** Run `npx jest src/crypto-sync src/statistics src/transactions`, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **step 6/7:** Commit `feat(binance): universal transfer walk (paired own-wallet legs, untracked wallet legs)`.
- [ ] **step 7/7:** Pre-BATCH-READY commands; `kiko:reviewer`. BATCH READY.

### binance-history task 6/7: Earn walk, caption over every walk (developer)

**Files:**
- Create: `binance.earn-history.ts`, `binance.earn-history.test.ts`, `binance.earn-history.rewards.test.ts`, `binance.earn-history.real-sqlite.test.ts`
- Modify: `run-crypto-sync.ts` + test
- Modify: `src/screens/account-detail/crypto-sync-section/binance-history-status.ts` + test, `crypto-sync-section.component.tsx` + its test
- Modify: `src/i18n/locales/en.ts`, `uk.ts` (`accountDetail.binanceHistoryPending`)

**Interfaces:**
```ts
export const EARN_WINDOW_MS = 30 * DAY_MS;
export const EARN_FLOOR_MS = Date.UTC(2022, 0, 1);
export const EARN_SETTLED_STATUS = 'SUCCESS'; export const EARN_FAILED_STATUSES: readonly string[] = ['FAILED'];
export const subscriptionLegs / redemptionLegs: (accountId, kind: 'flexible' | 'locked', record, holdings) => BinanceHistoryRow[] | 'stop' | 'ignore';
export const rewardRows: (accountId, kind: 'flexible' | 'locked', records: EarnReward[], holdings: Map<BinanceWalletKey, HoldingRow>) => BinanceHistoryRow[] | 'stop';
// placement by kind and type (Q14, ruling A): flexible REALTIME -> holdings Earn; flexible BONUS -> Spot; locked (any type) -> Spot;
// any other flexible type (including REWARDS) -> 'stop' with the tag `earn-reward-type-unknown`, no row guessed.
export const syncBinanceEarnHistory: (request: { targetAccountId: string; run: BinanceHistoryRun }, overrides?) => Promise<WalkResult>;
// binance-history-status.ts
export const walkCursorsOf: (holdings: Pick<HoldingRow, 'metadata'>[]) => (number | null)[]; // the four cursors of the holding that carries the capital cursor; four nulls if none
export const isBinanceHistoryBehind: (cursors: readonly (number | null)[], lastBalanceSyncAt: number | null) => boolean; // any null or any lag > DAY_MS
```
Keys: sub/redeem `` `${accountId}:earn:sub:<flexible|locked>:${purchaseId}:${holdingKey}` `` / `` `…:earn:redeem:<flexible|locked>:${redeemId}:${holdingKey}` ``, pair id the same without `:${holdingKey}`. Reward `` `${accountId}:earn:reward:<flexible|locked>:<projectId|positionId>:<type>:<time>:<n>` ``, description `'Binance Earn'`, no markers. Lane `earn`, cost `COSTS.earn`, pager `fetchAllByTotal`; gathered != `total` after a short page -> stop (`earn-page-drift`). Flexible rewards `type` is optional (default ALL); the client sends `type=ALL`, one series. Reward placement follows the spec's Q14 ruling A (see `rewardRows`).

- [ ] **step 1/8:** Write the failing tests: E1-E18 from the spec, one `it` each (E7 REALTIME -> Earn; E15 BONUS -> Spot; E16 locked -> Spot; E17 REWARDS or unknown type -> stop `earn-reward-type-unknown`, cursor unmoved; E18 / P7: a missing Spot holding is created at 0); E2 asserts three legs with one pair id, Spot and Funding counterparts = Earn, Earn counterpart = Spot (the larger leg; tie -> Spot); E4 `sourceAccount: 'FUNDING'`; a `FAILED` subscription is ignored and does not stop; an unknown status stops; floor 2022-01-01 and the 2017 reset (Review Focus 3); cap 30 and IP reading 5851 -> unaffordable; Review Focus 4 (real SQLite: group grows on re-read -> two rows, total 3 sat); E10/E11 idempotence (real SQLite). Caption: `isBinanceHistoryBehind` true for any null cursor, any lag > 1 day; false when all four within a day; false before the first balance sync; `walkCursorsOf` reads the Spot holding's four keys; the section shows `binanceHistoryPending` when only the Earn cursor is behind. `run-crypto-sync`: full order capital -> Pay -> Transfer -> Earn with one shared `run`; each walk's failure isolated; a 429 in Transfer -> Earn makes no request.
- **M3, from task 1/7 review:** a body `{ total: N }` with no `rows` parses as `rows: []`. The pager (or the client) must treat absent rows with `total > 0` as a stop or a parse error. Pin it.
- [ ] **step 2/8:** Run `npx jest src/crypto-sync/binance/binance.earn-history src/screens/account-detail`. Expected: FAIL.
- [ ] **step 3/8:** Implement `binance.earn-history.ts`. Rewards: place by kind and type (REALTIME -> Earn, BONUS -> Spot, locked -> Spot, else stop `earn-reward-type-unknown`); group by (kind, project/position id, `type`, `time`) within the fetched window, sort each group by satoshis ascending, number from 0. A missing/non-finite `time`, amount, or id stops the window.
- [ ] **step 4/8:** Wire after the Transfer walk with `logOnFailure('[binance sync] earn history failed', …)`. Export from the barrel.
- [ ] **step 5/8:** Implement the caption change; update `binanceHistoryPending` copy: en "Some Binance transaction history is not imported yet. Kiko will keep importing on each sync." uk "Частину історії транзакцій Binance ще не імпортовано. Кіко продовжить імпорт під час наступних синхронізацій."
- [ ] **step 6/8:** Run `npx jest src/crypto-sync src/screens/account-detail src/i18n`, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **step 7/8:** Commit `feat(binance): Simple Earn history walk (per-record rewards); history caption covers every walk`.
- [ ] **step 8/8:** Pre-BATCH-READY commands; `kiko:reviewer`. BATCH READY lists the changed en/uk key for translator review.

### binance-history task 7/7: VERIFY gate, skill rewrite, whole-branch gate (developer, scribe, reviewer)

**Files:**
- Create (gitignored, main checkout): `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/binance-history-verify.sh`
- Output (user run): `/Users/drizzer14/Developer/Projects/pff-ios/memory/refs/binance-history-verify-output-<date>.txt`
- Modify (scribe): `.claude/skills/kiko-architecture/SKILL.md` "Binance transaction history" (rewrite), plus `harness/kiko/skills/` / `harness/kiko/agents/` drift found by retrospect

The probe needs no app code: dispatch steps 1/7-3/7 right after task 1/7 lands, in parallel with tasks 2-6, so Q answers reach tasks 4-6 before their review.

- [ ] **step 1/7:** Developer writes `binance-history-verify.sh` on the `eodhd-verify.sh` pattern: `set -u`; hidden `read -rs` for key and secret; HMAC via `openssl dgst -sha256 -hmac` reading the query from stdin; curl `--config -` (key header and URL never in argv); masked URLs in output; prints only HTTP status, `code`, counts, field names and JSON types, never a raw body, id, amount, name or uid. It covers spec probe items 1-11, each under a numbered heading. Item 10 includes the count of reward `type` values per kind (before the merge, Q14) and the maturity-paid question (do locked reward rows exist that pay at maturity to the redeem destination, for example locked reward rows compared with locked positions and redemptions with `redeemTo` FLEXIBLE). Read-only endpoints only. Weight-safe: sleeps 400 ms between calls; stops on 429/418 and prints the item reached.
- [ ] **step 2/7:** The planner (or a fresh `kiko:reviewer`) reads the WHOLE script before it goes to the user: no secret echo, no `set -x`, no body dump, no write endpoint, every `curl` through `--config -`, heredocs quoted.
- [ ] **step 3/7:** The coordinator sends the user the run command and the output path. The user runs it and returns the output.
- [ ] **step 4/7:** The orchestrator maps every output item to Q1-Q16 and A1 (answered / safe default holds / rule change). A rule change updates the spec first, then gets its own fix task (renumber M). Before merge, the coordinator reports the Q14 probe counts (ruling A is made; the user may still check one BONUS or locked reward in the Binance app) and, if item 10 found identical reward records, Q16. Item 4's walletType-1 count > 0 opens the D3 follow-up (move old rows, with its own `kiko:reviewer`).
- [ ] **step 5/7:** `kiko:retrospect` on the branch, then `kiko:scribe` rewrites kiko-architecture "Binance transaction history" (four walks, shared run budget and caps, walk cursors, P7 insert-only ensure, placement by walletType, pairing and `untracked_counterpart`, caption over every walk, capital rows' `'BTC'` description, Convert deferred and why) and commits.
- [ ] **step 6/7:** `bash scripts/wait-load.sh 8` (background), then `env -u FORCE_COLOR make verify` at the branch tip until exit 0 with the full test count. Whole-branch `kiko:reviewer` pass (compliance brief: kiko-compliance 5.1.1/5.1.5, `memory/refs/resubmission-kit.md` section D unchanged, no new host).
- [ ] **step 7/7:** Final report: every task's base sha, `make mutable` count and `make deep` result (the coordinator's runs), the drift-fix sha, the probe mapping, and the open user confirmations.

## OVERNIGHT, needs user confirmation

Safest defaults applied by the planner on 2026-10-10 while the user was away. Each one is applied in the plan as written; the user can reverse any of them before the task that owns it.

1. P7 creates a missing wallet holding with a new insert-only `ensureExchangeHoldings`, not `upsertExchangeMany` (the upsert would zero a live balance). Task 2/7.
2. The Pay walk reads `fetchAccount` once per run for the `uid` (`{ ip: 20 }` on the Pay lane). A non-429 failure means `uid = null`. Task 4/7.
3. The Pay walk end is clamped to the capital cursor, so the newest Pay window can commit. Task 4/7.
4. The Transfer walk reads 20 types (the 18 untracked plus `MAIN_FUNDING`, `FUNDING_MAIN`). A first walk is about 140 calls over 3 runs. Task 5/7.
5. A known `uid` that matches neither Pay party counts as "signal 2 absent", following the spec text. The walk stops only when the signals disagree, or when the uid matches both parties. Task 4/7.
6. Untracked wallet display names (code-side proper nouns): 'USDⓈ-M Futures', 'COIN-M Futures', 'Margin', 'Options', 'Portfolio Margin'. Task 3/7.
7. The same-currency "Transfer to/from" label also applies to existing MANUAL same-currency Exchange legs, because the spec compares currencies generally. Task 3/7.
8. The uk `transferTo/From` strings take no «» quotes, the same as the existing `exchangeTo/From`. They go to translator review. Task 3/7.
9. RESOLVED (step 2/9 SDK facts): type optional; client sends type=ALL, one series. Tasks 1/7 and 6/7.
10. The migration takes number 0056. It is renumbered if build 29 lands a migration first. Task 3/7.
11. Earn key layout: `earn:sub:<flexible|locked>:<purchaseId>:<holdingKey>`, `earn:redeem:…`. The pair id is the same without the holding key. Task 6/7.
12. Earn statuses: only `SUCCESS` imports and `FAILED` is ignored. Any other status stops the window. Task 6/7.
13. Walk stops are logged as `logFailure(tag, new BinanceWalkStop(code))`, so only the name and the fixed code reach the log. Tasks 2/7-6/7.
14. The plan keeps the spec's 7 tasks. Task 3/7 mutates four large files, so its `make deep` is slow. The alternative is to split task 3/7 into "migration + exclusion" and "labels + callers", which renumbers the plan to 8 tasks.
15. The probe script (task 7/7, steps 1/7-3/7) is dispatched as soon as task 1/7 lands, in parallel with tasks 2-6.

## Self-review

- Spec coverage: client (1/7), budget, caps, order, cooldown, cursors, generic writer, capital D3 (2/7), D5 column, exclusion, labels, back-compat (3/7), Pay (4/7), Transfer (5/7), Earn D6, caption and copy (6/7), probe and skill (7/7). Convert: no task (D7).
- Names used across tasks: `BinanceHistoryRun`, `createBinanceHistoryRun`, `WalkResult`, `BinanceWalkStop`, `resolveWalletHoldings`, `ensureExchangeHoldings`, `setBinanceWalkCursor`, `fetchAllByTotal`, `BinanceHistoryRow`, `COSTS`, `untrackedWalletCode`.
