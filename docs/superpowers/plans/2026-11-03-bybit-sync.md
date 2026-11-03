# 1.4-bybit task 1/1: Bybit sync implementation plan

> For agentic workers: use superpowers:subagent-driven-development. Steps use `- [ ]` tracking.

**Goal:** Bybit balances, then tested data kinds, from a read-only key, visible and complete at each stage.

**Architecture:** A new `src/crypto-sync/bybit/` beside `binance/`, on the shared walk. Seams 1, 2 and 7 get
parameters first; the provider id and core follow with no way in from the UI, seams 3, 4 and 9 change with the id, and
the catalog entry goes last.

**Spec:** `docs/superpowers/specs/2026-11-03-bybit-sync-design.md`. Section numbers below are the spec's. Plan
text never overrides it; a difference found is reported.

**Status:** No app code until the coordinator relays the user's approval. Q1 default A+B, Q2 default no
notification, Q3 default accept, Q4 default ship with the copy of O26 (spec section 13). Mutation gates are paused by the user since 2026-10-25: verify and review only;
the gate text stays below for when it is lifted.

## Global constraints

- Base 57130e23c at this writing; each set's base is the tip of the set before it. Every code fact is a symbol or
  anchor text: re-grep it on the actual base. Every count is a FLOOR measured at 57130e23c; the developer measures.
- Commit granularity: per step, one `kiko:qa` RED commit showing the failing output on the parent, then one
  `kiko:developer` GREEN commit. A message names `1.4-bybit set N/10 step n/m`. A re-pin names the ruling that forces
  it and lists old title to new title in the commit body. No red commit may import a module that does not exist yet.
- Tests by an agent: `npx jest <files> --maxWorkers=2` and `make jest-affected`. Never full jest, `make verify` or
  `check:all`. Exit 3 from `make jest-affected`: tell the coordinator.
- Coordinator's queue, per set tip: `bash scripts/job-queue.sh verify <worktree> <label>`, rerun until green. Gate,
  when lifted: `scripts/job-queue.sh gate` per set, `KIKO_MUTATION_BASE` = that set's base, never a whole-branch run;
  over 30 mutable files exits 2. Each set below stays under it; `make mutable` measures.
- Set 2's tip is shippable alone. Sets 3 to 6 tips are not: they stay out of `next` until set 7 passes on device (O21,
  "Merge order"), and each still passes its queued verify. At every tip: no way in from the UI before set 7; every new
  export has a consumer at that tip, or knip fails. No held tip runs `privacy:site check`: it compares the live page, and
  it runs at publish only (O29). UI uses theme tokens only: `tone=`, `theme.iconSizes`, no colour literal (O12).
- No migration in any set, so no migration review and no EXPLAIN test. No `BinanceX` rename (O7).
- Every set: a `kiko:reviewer` pass on its diff before merge; after it, the session's skill-drift rule (retrospect
  verifies, scribe fixes) unless the orchestrator folds it into set 10; the report names the drift sha or "no drift".
- A new test file stays under 1000 lines; split by concern (memory new-test-file-over-1000-lines-dup-regression).

## File map

| Path | Responsibility | Set |
|---|---|---|
| `src/crypto-sync/bybit/bybit.endpoints.ts` | closed path unions | 3 |
| `src/crypto-sync/bybit/bybit.client.ts` | signing headers, refusal classes, one balance read each | 3 |
| `src/crypto-sync/bybit/bybit.credentials.ts` | Keychain pair over `exchange/credentials`, `createWriteSerial` | 3 |
| `src/crypto-sync/bybit/bybit.cooldown.ts` | per-account cooldown | 3 |
| `src/crypto-sync/bybit/bybit.holding-keys.ts` | `<COIN>:<wallet>`, names, pair id | 3 |
| `src/crypto-sync/bybit/bybit.tracked-coin.ts` | `isTrackedBybitAsset`, `BYBIT_FIAT_CODES` | 3 |
| `src/crypto-sync/bybit/bybit.provider.ts` | balance read | 3 |
| `src/crypto-sync/bybit/bybit.key-expiry.ts` | state of the stored date | 4 |
| `src/crypto-sync/bybit/bybit.history-budget.ts` | lanes, caps, gate interval | 5 |
| `src/crypto-sync/bybit/bybit.walk-config.ts` | `ExchangeWalkConfig` | 5 |
| `src/crypto-sync/bybit/bybit.cursor-span.ts` | `readCursorSpan` | 5 |
| `src/crypto-sync/bybit/bybit.history-client.ts` | row parsers | 5, 6 |
| `src/crypto-sync/bybit/bybit.capital-history.ts` | capital walk | 5 |
| `src/crypto-sync/bybit/bybit.transfer-history.ts` | transfer walk | 6 |
| `src/design-system/components/bybit-credentials-field/` | connect field | 7 |

## 1.4-bybit set 1/10: the probe script, the terms verdict and the user's probe run

Base: 57130e23c, plus the approved spec. Size: 1 script of about 600 to 900 lines, 1 test, no app file. Not mutable.
Reviewer checks: the whole script for any leak path; every part against spec section 10; no write verb. "Set 1 tip" is
the commit after the last step that writes results: the second run of step 7/7, for R3 and R4 (O36). Set 2 bases on it.

The user's order (O23, O31, O36): part 1 of the browser step (step 4/7), the terms verdict at once (step 5/7), THE KEY
MOMENT R1 (step 6/7), R2, R3, R4 with the redeem, then after Q1 R5 and R6, and R7 on its date.

- [ ] **step 1/7: write `memory/refs/bybit-probe.sh`** (main checkout, untracked, like its templates; `kiko:ops` or
  the coordinator names the writer). Pattern: `binance-transfer-depth-probe.sh`, `eodhd-verify.sh`: hidden prompts,
  `curl -q -K -` with URL and key on stdin, perl HMAC with the secret on stdin, alnum-checked key, masked URLs. Parts
  P1 to P18 and the allowlist-only printer of spec section 10; `set -u`; a Ctrl-C prints what was read.
- [ ] **step 2/7: fake-curl test.** A fake `curl` on `PATH` feeds sentinel email, phone, address, name, id and key
  values for every part. Check: no sentinel appears on stdout or stderr, and the key is in no argv.
- [ ] **step 3/7: read the whole file** (orchestrator) and hand it over through the coordinator with part 1 of the
  browser step first, then the R1 account list and part 2 (spec section 9).
- [ ] **step 4/7: the user's first step: part 1 of the browser step** (O23; PLANNER CALL 18): no account, no key, no
  money. The sentences go to `memory/refs/bybit-terms-sentences-<date>.txt` and at once to step 5/7.
- [ ] **step 5/7: the API terms verdict (O23, O36).** At once on the pasted sentences, before R1 and before any of the
  user's money. A `kiko:reviewer` reads the step 4/7 sentences and the terms table of spec section 9, and rules on clauses
  6.5 and 6.9 by name. It needs no probe output. Stop rule: a clause that forbids this use stops the track here, and the
  coordinator takes it to the user. The verdict goes into spec section 9. `make doc-suites`. A page that needs a login
  waits for R1, which holds no money; the same reviewer reads its sentences before R2.
- [ ] **step 6/7: THE KEY MOMENT. The user runs R1, R2, R3, R4,** in the order and with the holdings of spec section 10:
  part 2 of the browser step at R1, P4 also while K1 is pending (O16, O32), K6 from each wallet that Bybit allows (O14),
  and last at R4, for every Q1, K11, the redeem of Flexible Savings, with a P3 run after it (O31). Outputs go to
  `memory/refs/bybit-probe-output-<date>.txt`. The date of `expiredAt` goes into the track HANDOFF and the run log as an
  open gap until R7 runs. R5, R6 only after Q1. R7 on that date.
- [ ] **step 7/7: write results into the spec.** `kiko:planner` turns each UNPROBED row into MEASURED or edits it; the
  same pass edits this plan, picks the outcome of rules 45, 46 and 47 and the section 8 clauses, and states the needed
  boxes of each kind (O13). A P12 refusal moves a floor; an empty 0 keeps 729 days (O20). Check: `git grep -c UNPROBED`
  on the spec falls to the stage C and D rows, the rows of P5 and P17, and rule 47 if the user missed the pending window
  (O32, O35). A row keeps its mark until its own probe runs. A kind that failed goes to its text in section 8. A shape
  change that reverses a row adds a was column. `make doc-suites`. This step runs once for R1 and R2 and again for R3 and
  R4; the second run's commit is the set 1 tip.

Gate per stage: every code set bases on the set 1 tip or later, so P1 to P7, P11, P12, P13, P15, P16 and step 5/7 hold at
each of them, with each row's mark per step 7/7. Set 3's Earn step uses the P3 run after the redeem (O31).

## 1.4-bybit set 2/10: neutral seams, Binance unchanged

Base: set 1 tip. Order: first code set. Size: about 210 code lines in 9 to 12 files, about 450 test lines (was 280, 13
to 16, 650: O30 moves seams 3, 4 and 9 to set 3). Tip: no Bybit id, no visible change. Merges alone (O21). At this set,
existing suites stay green unchanged except the re-pins of step 3/4 (no owed state added, no 1.2-upgrade seed moves); set 3
step 6/6 re-pins the status suites' calls (O30). Reviewer checks: a Binance run writes byte-identical rows, marks and text;
no behaviour moved for `binance` or `btc_wallet`; each seam's red shown on the parent; seams 3, 4 and 9 untouched.

- [ ] **step 1/4: run the older-build restore (O10).** On this tip, before any id exists, a scratch test under
  `.superpowers/sdd/1.4-bybit/` (not committed to `src/`) restores a fixture file: a `bybit` account, `bybitAsset`
  holdings, `source: 'bybit'` rows, walk state, a `bybitCredentials` list. Check: restore passes, the account reads
  unsynced, no Keychain write for it. Output in the commit body and spec section 6.6. A failure stops the set and
  flips the decision: report it.
- [ ] **step 2/4: seam 2, `source` on the config.** `ExchangeWalkConfig` gains `source`; `PlacedWalletRow.source`,
  `placeWalletRows`; `BINANCE_WALK_CONFIG.source`. Files: `exchange/walk/walk-config.ts`, `exchange/walk/records.ts`,
  `binance/binance.walk-config.ts` and the tests that hand a config. Check: `npx jest` on those; Binance rows same.
- [ ] **step 3/4: `walk.ts` log tags to `[exchange sync]`** (5 sites). Re-pin 27 literal lines in 10 test files, one of
  them a fixture, naming O7 (O28; MEASURED 2026-11-03 at ef21601bd, `git grep -c` on the 5 tags, a floor): `walk.test.ts`
  1; `binance.history-walk.test.ts` 5; `binance.history-records.test.ts` 3; `binance.transactions.test.ts` 6;
  `binance.transactions.coins.test.ts` 1; `binance.pay-history.test.ts` 6; `binance.pay-history.untracked.test.ts` 1;
  `binance.earn-history.test.ts` 2; `binance.transfer-history.test.ts` 1; the fixture `binance.earn-test-fixtures.ts` 1.
  Grep every suite for the literal first; the developer measures again on the actual base. The call stands (PLANNER
  CALL 12).
- [ ] **step 4/4: seams 7 and 1, plus shared extraction.** `scripts/checks/plist.sh` regex gains `X-BAPI-API-KEY`;
  row in `__tests__/plist-credential-detect.test.ts`. `ensureExchangeHoldings` reads an institution list,
  `isWalletHoldingInstitution`, holding `binance` only at this tip. `runExchangeWalkPlan` and `commitExchangeSpan`
  move to `exchange/walk/`, with `binance.walk-wiring.ts` their thin caller (consumer at this tip); `createWriteSerial`
  waits for its consumer in set 3. Check: Binance's walk suites unchanged; `npm run check:plist`; `npm run check:dup`.

## 1.4-bybit set 3/10: provider id, client, keys and balances (stage A core)

Base: set 2 tip. Needs step 5/7 of set 1 and P1, P2, P11, P15, P16; step 5/6 needs P3, with the run after the redeem. Size:
about 1,270 code lines in 25 to 29 files (under the cap of 30; `make mutable` measures, and a count over the cap is a
report to the orchestrator), about 2,250 test lines (was 1,200, 21 to 25, 2,050: O30 moves seams 3, 4 and 9 here; O31, O33
add rows; O29 moves the policy, its site pages and `bybit.privacy-policy.test.ts` to set 7). Tip: `bybit` in
`balanceProviderIds`, every arm present, no catalog row and no registry entry, so no way in (`syncJobsFor` skips an
unwired id; pinned by the unwired-provider guides). Stays out of `next` (O21). Reviewer checks: compliance items (pins,
no-store, `hardenedFor`, no personal field parsed); retCode before status; each refusal class; balance anti-goals; fixtures
from the probe output, never real values; every Binance caption result the same after the re-pins.

- [ ] **step 1/6: host and pins.** `ios/Kiko/Info.plist` pin block (spec section 9), `.env.example`, `.env.test`,
  local `.env`, `src/env.d.ts` (`BYBIT_API_ENDPOINT`), `docs/security/README.md` table and host loop. Re-run the runbook's
  `openssl` line first. The policy step is set 7 step 4/6 (O29). Check: `npm run check:plist`, `plutil -lint`.
- [ ] **step 2/6: client.** `bybit.endpoints.ts`, `bybit.client.ts`: `signedBybitGet` with the four headers and
  `no-store`, `fetchKeyInfo` (with `readOnly`, `isMaster`, `permissions` for set 7), `fetchUnifiedBalance`,
  `fetchFundBalance`, the refusal table of spec section 4, `BybitRateLimitError`, `BybitRefusalError`. `bybit.cooldown.ts`.
  `BYBIT_SIGNED_PATHS` in `bybit.endpoints.ts`, a path added in each later step that adds a route. Check: rows
  A9, A10, A15; `npm run check:plist` now sees the client; `check:dup`.
- [ ] **step 3/6: Keychain.** `exchange/credentials`: `createWriteSerial`; `bybit.credentials.ts`: service
  `kiko.bybit.credentials`, username `bybit`, save, read, clear, clear-if-written. `accounts.repo.ts`
  `clearKeychainItems` (seam 6). `src/holdings/holding-metadata`: member `bybitAsset`. `ExchangeMetadataField` follows.
  Check: writer goes through `hardenedFor`; delete clears (seam 6 red); no secret in a log.
- [ ] **step 4/6: coins and keys.** `bybit.tracked-coin.ts` with `BYBIT_FIAT_CODES` re-read from the public
  `instruments-info` (spec rule 9), the list stays the 5 codes (O19), `bybit.holding-keys.ts`. The tracked predicate
  `isTrackedBybitAsset` is written here; step 6/6 wires it to the section. Check: A8, A38, property Q2 start.
- [ ] **step 5/6: balances.** `bybit.provider.ts` on the order of spec rule 3; `fetchEarnPositions` after P3, by spec
  rule 46: a row with a `status` needs the allowlist, a row with none adds its `amount` (O31). If P3 shows no separate
  money, leave Earn out and take clause E3; with no on-chain position, clause E2; if the redeem shows a redeemed row with
  no `status` and a non-zero `amount`, leave FlexibleSaving out and take clause E4. Patch kind `balanceNotes` in
  `exchange-state-patch.ts` for the refused wallets, borrowed coins and Earn left-out count, per wallet, on the
  `oversizedBalance` and `complete` precedent: a wallet that this run read replaces its notes, and a wallet that failed
  keeps them, plus its refused mark on a 10005 (O33, PLANNER CALL 17). Rows A1 to A7, A11, A31, A34 (state part), A36, A37,
  A46 (provider part), A47, A48.
- [ ] **step 6/6: the `bybit` id, arms, seams 3, 4, 9 and the Bybit tracked predicate (O30).** Red first with the real id,
  on the parent, in existing suites and in `exchange-history-gate.test.ts`, so no red imports a missing module.
  - Arms: `balanceProviderIds`, `run-crypto-sync.ts` (`bybit` arm, join, no walks yet), `resync-request.ts`, `disconnect.ts`,
    `db/schema.ts` `source` list, `isWalletHoldingInstitution` gains `bybit` (seam 1 red, real SQLite). Re-pin
    `provider.test.ts`, naming the Bybit id.
  - Seam 3, source module `src/screens/account-detail/crypto-sync-section/binance-history-status.ts` (PLANNER CALL 20):
    `hasExchangeHistory(provider)` over a table typed `Record<BalanceProviderId, boolean>`, `bybit: true`, so a new id
    does not compile with no decision. It replaces the three `connectedProvider === 'binance'` gates in
    `crypto-sync-section.component.tsx` (`historyPaused`, `coinLinesShown`, `historyBehind`). Row A42.
  - The Bybit tracked predicate (PLANNER CALL 21): a table typed `Record<BalanceProviderId, ...>` in the same module, with
    `isTrackedBinanceAsset` and `isTrackedBybitAsset`; the `untrackedCoinsOf(walkState, isTrackedBinanceAsset)` line of the
    section reads it.
  - Seam 4: `captionWalksOf(provider)` over a table typed by the id, Binance's 8 the same, `btc_wallet` none, `bybit` none.
    A required parameter, no default to Binance. Lines to change (MEASURED 2026-11-03 at cba12d6f4 with `git grep`, a floor;
    the developer measures again): in `binance-history-status.ts` the `CAPTION_WALKS` declaration and its 3 use lines (2 in
    `walkCursorsOf`, 1 in `historyOwesRange`); in `crypto-sync-section.component.tsx` 2 call lines (`walkCursorsOf(walkState)`,
    `historyOwesRange(walkState, lastBalanceSyncAt)`); in tests 25 call lines, `binance-history-status.test.ts` 24 and
    `binance-history-status.quiet-syncs.test.ts` 1. A multi-line call counts by its first line. Each test call gains the
    argument, with the same expected result, naming O30 in the commit. Row A49.
  - Seam 9: `accountDetail.untrackedCoins` takes `{{exchange}}` in en and uk; the output for Binance is byte-identical (pin
    it). `CoinLines` gets the name through `providerDisplayName`.
  - Check: `make jest-affected`; tsc; `npx jest` on the section suites, Binance's caption results the same.

## 1.4-bybit set 4/10: expiry, `.kiko`, switch gate, account detail

Base: set 3 tip. Size: about 550 code lines in 13 to 15 files, about 1,050 test lines (was 450, 12 to 14, 900: O13, O18,
O26, O27 lines). Tip: text keys exist and render only for a connected `bybit` account, which no path can create yet.
Stays out of `next` (O21). Reviewer checks: every expiry state on every surface against spec section 6.3; the switch gate
cannot strand a Binance user; translator review of this set's keys.

- [ ] **step 1/4: key expiry state.** Patch kind `keyExpiry` in `exchange-state-patch.ts`, reader `keyExpiryOf` in
  `walk-state.ts` and `history-status`, `bybit.key-expiry.ts`, the provider's patch. Rows A14, A16, part of A26.
- [ ] **step 2/4: section surfaces.** The expiry line in `crypto-sync-section.component.tsx`, refusal texts in the
  provider (localized as Binance's), `bybitKinds` in the connected state; reader `balanceNotesOf`, then
  `bybitCoinBorrowed`, `bybitWalletRefused` and `bybitEarnLeftOut` beside `CoinLines`. Keep the section's complexity
  budget: split a small component. Check: section tests per state; A15, A34 (line part), A45, A46 (copy part).
- [ ] **step 3/4: `.kiko` entry (seam 5).** `payload.d.ts`, `is-export-secrets.ts`, `read-secrets.ts`,
  `restore-secrets.ts`, `import-data.screen.tsx` kinds. Re-pin the shape suites of seam map section 10 naming O10. No
  version bump. Check: A29, round trip. The quoted-name trap: read fields by property (`is-export-secrets` header).
- [ ] **step 4/4: switch gate (O11).** `conflictingExchangeHoldings`, `ConnectExchange`, `exchangeSwitchRefused`. Check:
  A28, Binance to wallet unchanged.

## 1.4-bybit set 5/10: cursor reader, budget and capital walk (stage B)

Base: set 4 tip. Needs P4, P5, P6, P11, P12, P13. Dropped if Q1 = A. Size: about 950 code lines in 7 to 9 files, about
1,750 test lines, split (was 900, same, 1,600: O14, O32, O20). Tip: the run arm reads deposits and withdrawals; still no
way in. Stays out of `next` (O21). Reviewer checks: each early return of spec section 5; settled matrix; no stored cursor;
`withdrawType=2`; O6 sentinel; the floor stays 729 days unless a P12 refusal moved it (O20); rule 45 and 47 outcomes.

- [ ] **step 1/4: budget and config.** `bybit.history-budget.ts` (`BybitLane`, caps 30 and 20, interval 1100,
  `createBybitHistoryRun`, refused call counted), `bybit.walk-config.ts` (`source: 'bybit'`, `bybitAsset`). Interval
  and caps may change only by P16 or a P12 refusal, and the spec's section 5 changes with them.
- [ ] **step 2/4: `readCursorSpan`** (`bybit.cursor-span.ts`), at the `walkSpans` `read` seam: follows
  `nextPageCursor`, `canAfford` per page, `split` over a day, `undefined` at a day or less, repeat cursor or row outside
  `reach` is `bybit-page-drift`; a pending row with no time is never drift, and the time sort leaves it out (rule 19,
  rule 47, O32). No `readIdCursor` or `readSeriesSpan` stretch (O8). Rows A20, Q5 start.
- [ ] **step 3/4: parsers.** `bybit.history-client.ts`: tracked rule, unreadable, untracked counted never parsed, named
  fields only, `BybitHistoryParseError`, time units from P4, P5, P6; an empty, 0 or absent time reads the same (O32). Paths added to `BYBIT_SIGNED_PATHS`.
- [ ] **step 4/4: the capital walk.** `bybit.capital-history.ts`: series `deposit`, `internal` (only if P5 passed),
  `withdraw`; windows 29 days; floor `now - 729 days`, which only a P12 refusal moves, never an empty 0 (O20); `reach`;
  removal of 70011; forward owes constant per the Transfer rule. Row wallet by the outcome of spec rule 45 (O14): the
  field P4 and P6 showed, or FUND with clause W1. The walker stays as it is: a pending row with no time owes its span as
  a range through `pointOf` and `owedBy`, and the caption shows while it is pending (rule 47, O32). Guard on an empty plan
  tests all four lists. Arm: `capital` in `logOnFailure`, `captionWalksOf('bybit')` gains `capital`. Rows A17
  to A22, A27, A30, A35, A39, A41.

## 1.4-bybit set 6/10: transfer walk and convergence proof (stage B)

Base: set 5 tip. Needs P7, P13. Dropped if Q1 = A. Size: about 500 code lines in 5 to 6 files, about 1,200 test lines.
Stays out of `next` (O21). Reviewer checks: pair id has one coin; wallet words closed; section 5 tables replaced with
measured numbers.

- [ ] **step 1/3: `bybit.transfer-history.ts`**, 7-day windows, both legs, pair id from `bybit.holding-keys.ts`, unknown
  wallet owed. Arm and `captionWalksOf('bybit')` gain `transfer`. Rows A23 to A25, A26.
- [ ] **step 2/3: `bybit.keys.property.test.ts`, `bybit.convergence.test.ts`**, Q1 to Q7, run through real
  `planWalkPasses` and `runWalkPlan` with a fake route that serves the seeds, cut at every commit for the restart property,
  and added to `__tests__/property-sweep-sites.test.ts`. A red for Q3 shown by a mutant that drops a mark.
- [ ] **step 3/3: measured numbers.** Scribe writes the convergence table's MEASURED column into spec section 5. A cap that
  fails a seed's bound is a report to the orchestrator, never a loosened bound.

## 1.4-bybit set 7/10: the way in, shipped stage A+B (catalog last, O9)

Base: set 6 tip (set 4 tip if Q1 = A, and the A-only copy). Needs P1, P11 (boxes), part 2 of the browser step (URL). Size:
about 450 code lines in 16 to 20 files, about 900 test lines (was 450, same, 850: O29 moves `bybit.privacy-policy.test.ts`
here), plus the policy and site pages (O29). Tip: Bybit visible and complete. Merge: the batch of "Merge order", only after
the device check on this branch (PLANNER CALL 15). Reviewer checks: compliance section whole, each surface's copy against
spec section 8, help pins, the policy text against spec section 9; kiko:translator on every new key.

- [ ] **step 1/6: credentials field.** Extract `ExchangeKeyForm` from `binance-credentials-field`, Binance's suite unchanged;
  new `bybit-credentials-field` over it, verifying through `fetchKeyInfo`; refusals in the order of spec section 6.8 with the
  boxes per kind from set 1 step 7/7 (O13), all before any Keychain write; `bybitConnectLimits` and `bybitKinds` before the
  inputs; `BYBIT_API_MANAGEMENT_URL` in the env files, and `www.bybit.com` in `scripts/privacy-site.js` `NON_REQUEST_HOSTS`
  in this same step. Rows A12, A13, A32, A33. Check: `npm run privacy:site -- hosts` does not list `www.bybit.com`.
- [ ] **step 2/6: wiring.** `exchange-catalog.ts` id and row before `other`, `exchange/registry/registry.ts` entry with
  `notListedKey`, `crypto-sync-form.component.tsx` arm, `crypto-sync-section.component.tsx` connect callback,
  `account-form.screen.tsx` and `use-connect-reminder.ts` per-provider props, `clearPairIfRowMissing` for Bybit. Re-pin
  `exchange-catalog.test.ts`, `registry.test.ts`, `crypto-sync-section.component.connect.test.tsx`, naming O9. Row A43,
  red on the parent, where `bybit` has neither entry (O21).
- [ ] **step 3/6: help and shipped copy.** Grep the help pins, `en.casing-by-role`, and uk first; in ONE step edit
  `help-topics.ts` (a sixth step key), en, uk, `help-topics.test.ts` (count 6, step 3 still Binance). The keys of steps 4 and
  5 move: per harness-workflow "Removing or renaming a catalogue key", every dependent edit stays in this step. The step text
  ends with the shipped `bybitKinds` text. `bybit.shipped-copy.test.ts`, one row per kind set (O15). Row A40.
- [ ] **step 4/6: the policy (O29, O24, O15, O34).** The block and the section 3 intro of spec section 9, with the variant
  that fits the shipped kind set and Q1, in `docs/privacy-policy.en.md`, `docs/privacy-policy.md`, site rebuilt under
  `docs/privacy-site/` (`npm run privacy:site -- build`); only the shipped paths in `BYBIT_SIGNED_PATHS` (O15);
  `bybit.privacy-policy.test.ts` on those paths. Effective date: bump it in this edit; the publish re-dates it to the
  publish day if gh-pages goes out later (release skill, "Privacy policy check"). Check: A44, A50, uk apostrophe suite. The
  live `npm run privacy:site -- check` runs at publish only, before the upload, not on this tip.
- [ ] **step 5/6: App Review notes and kit section D (O22).** Owner: `kiko:release`, because the kit
  (`memory/refs/resubmission-kit.md`) is outside the repository; the coordinator runs it. Per kiko-compliance's "reviewer
  notes must supply it or say how to get it": the notes name Bybit, what it reads, the user's own key and how to get one,
  and the HTTP 403 on a US IP with `bybitForbidden`. Per its "does the dataset show it?": state whether the demo `.kiko` shows
  Bybit, with the reason. Kit section D gains the App Privacy line. Check: the coordinator reads both texts against spec
  section 9; no app file changes.
- [ ] **step 6/6: device check, user on device.** Build from this branch. If Flexible Savings ships, the user subscribes
  again first, because K11 redeemed it (PLANNER CALL 22). Each kind against the small account, each surface
  in section 6.4; expiry line; a wrong key; a read-write key; a key not on the main account; a key with a missing box;
  disconnect and reconnect; Binance still syncs; light and dark. Positive and negative pin checks of
  `docs/security/README.md`. The coordinator owns device builds. Pass: the batch merge. A stop here: sets 3 to 7 stay out of
  `next`, and no removal row is needed.

Stop here if Q1 = A or A+B: sets 8 and 9 are not built in 1.4. Q1 = A+B+C builds set 8; Q1 = all builds sets 8 and 9 (O36).

## 1.4-bybit set 8/10: stage C, log and convert (outline; detail after the user's Q1)

Needs P8, P9 (R5). Expected: new `WALK_IDS` member `log` with its fan-out (`walk-state.test.ts` and siblings), not-imported
kind, allowlist of seen `type` values, `convert` walk or read, double-read rule. Size floor: 800 code lines, under 15 files.
Copy edits in the same set. Reviewer: nothing parsed outside the allowlist; a trade never counted twice.

## 1.4-bybit set 9/10: stage D, Earn orders and yield (outline; detail after the user's Q1)

Needs P10 (R4, R6; the order of K11 at R4, PLANNER CALL 22). Expected: `earn` walk id, flexible orders, yield per category, floor `now - 90 days`, own lane under the
gate. Size floor: 500 code lines, under 10 files. Reviewer: what the 3-month floor drops, stated in copy.

## 1.4-bybit set 10/10: skill drift

Base: the last built set. Size: skill and agent text only. Reviewer: `make doc-suites`.

- [ ] **step 1/2:** `kiko:retrospect` verifies `.claude/skills/`, `harness/kiko/skills/`, `harness/kiko/agents/` against the
  code.
- [ ] **step 2/2:** `kiko:scribe` adds a "Bybit" section to `kiko-exchange-sync`, updates kiko-compliance (the terms verdict,
  pins), kiko-domain (registry) and kiko-architecture (`.kiko` secrets), and commits. The report names the sha.

## Merge order

A recommendation to the coordinator, who owns the merge (O21). Sets 3 to 7 stay out of `next` until set 7 passes on device,
then merge as one batch, so no dormant reader reaches `next`. If set 7 stops, no removal row is needed; set 2 holds no Bybit
id and may stay. The cost is one larger merge.

| Q1 | Order into `next` |
|---|---|
| A+B (default) | 2 alone; then the batch 3, 4, 5, 6, 7 after the device pass; then 10 |
| A | 2 alone; then the batch 3, 4, 7 after the device pass; then 10 |
| A+B+C | as A+B; then 8 after the batch, with its own device check, before 10; 9 is not built |
| all | as A+B; then 8 and 9, each after the batch, each with its own device check, before 10 |

Set 1 merges nothing but its spec edit. Each set tip has its queued verify, and the merged tip of each merge has a queued
verify green. `1.4-light-scheme` may land first: theme tokens keep sets 4 and 7 unaffected.

## Sizes

| Set | Code lines (about) | Code files | Test lines (about) |
|---|---|---|---|
| 1 | script 600-900 | 1 | 1 fake-curl test |
| 2 | 210 | 9-12 | 450 |
| 3 | 1,270 | 25-29 | 2,250 |
| 4 | 550 | 13-15 | 1,050 |
| 5 | 950 | 7-9 | 1,750 |
| 6 | 500 | 5-6 | 1,200 |
| 7 | 450, plus copy, the policy and site pages | 16-20 | 900 |
| 8 | outline, 800 | under 15 | outline |
| 9 | outline, 500 | under 10 | outline |
| 10 | docs | | |

A duration for any of these comes from `kiko:estimator`.

## Self-review

Spec coverage: a section 1, b 2, c 3, d 5, e 6, f 7, g 8, h 9, i 10, j 11. O1 to O12 hold: O1, O2 set 7 and 3; O3 set 3 step 2;
O4 set 3 step 4; O5, O6 set 5 step 3 and set 7 copy; O7 set 2; O8 set 5 step 2; O9 set 7; O10 set 2 step 1 and set 4 step 3;
O11 set 4 step 4; O12 global. O13 to O28: O13 set 3 steps 2, 5, set 4 step 2, set 7 step 1; O14 set 1 step 6, set 5 step 4;
O15 set 3 step 5, set 7 steps 3, 4; O16 set 1 step 6 (words corrected by O32); O17 set 3 step 6 (double replaced by O30); O18
set 3 step 5; O19 set 3 step 4, spec backlog; O20 set 1 step 7, set 5; O21 global, set 7 step 2, "Merge order" (policy sentence
reversed by O29); O22 set 7 step 5; O23 set 1 steps 4, 5; O24 set 7 step 4; O25 spec section 8, set 7 step 3; O26 set 4 step 2,
Q4; O27 set 3 step 5, set 4 step 2; O28 set 2 step 3. O29 to O36: O29 global, set 3 step 1, set 7 steps 1, 4; O30 set 2 header,
set 3 steps 4, 6; O31 set 1 step 6, set 3 step 5, set 7 step 6, spec sections 8, 9, 10; O32 set 1 steps 6, 7, set 5 steps 2, 3,
4; O33 set 3 step 5; O34 set 7 step 4, spec section 9; O35 set 1 step 7; O36 set 1 header, step 5, "Merge order", set 7 stop line.

Acceptance rows: A1 to A7, A11, A31, A36, A37, A47, A48 set 3 step 5; A8, A38 set 3 step 4; A9, A10 set 3 step 2; A14, A16 set 4
step 1; A15 set 3 step 2, set 4 step 2; A17 to A22, A27, A30, A35, A39, A41 set 5 step 4; A23 to A25 set 6 step 1; A26 set 4
step 1, set 6 step 1; A28 set 4 step 4; A29 set 4 step 3; A12, A13, A32, A33 set 7 step 1; A34, A46 set 3 step 5, set 4 step 2;
A40 set 7 step 3; A42, A49 set 3 step 6; A43 set 7 step 2; A44, A50 set 7 step 4; A45 set 4 step 2.
