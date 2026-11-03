# 1.4-bybit task 1/1: Bybit sync implementation plan

> For agentic workers: use superpowers:subagent-driven-development. Steps use `- [ ]` tracking.

**Goal:** Bybit balances, then tested data kinds, from a read-only key, visible and complete at each stage.

**Architecture:** A new `src/crypto-sync/bybit/` beside `binance/`, on the shared walk. Nine silent seams get
parameters first; the provider id and core follow with no way in from the UI; the catalog entry goes last.

**Spec:** `docs/superpowers/specs/2026-11-03-bybit-sync-design.md`. Section numbers below are the spec's. Plan
text never overrides it; a difference found is reported.

**Status:** No app code until the coordinator relays the user's approval. Q1 default A+B, Q2 default no
notification, Q3 default accept (spec section 13). Mutation gates are paused by the user since 2026-10-25: verify and review only;
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
- Every set tip is shippable alone: no user-visible text before its feature; every new export has a consumer at that
  tip, or knip fails. UI uses theme tokens only: `tone=`, `theme.iconSizes`, no colour literal (O12).
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

## 1.4-bybit set 1/10: the probe script and the user's probe run

Base: 57130e23c, plus the approved spec. Size: 1 script of about 600 to 900 lines, 1 test, no app file. Not mutable.
Reviewer checks: the whole script for any leak path; every part against spec section 10; no write verb.

- [ ] **step 1/5: write `memory/refs/bybit-probe.sh`** (main checkout, untracked, like its templates; `kiko:ops` or
  the coordinator names the writer). Pattern: `binance-transfer-depth-probe.sh`, `eodhd-verify.sh`: hidden prompts,
  `curl -q -K -` with URL and key on stdin, perl HMAC with the secret on stdin, alnum-checked key, masked URLs. Parts
  P1 to P18 and the allowlist-only printer of spec section 10; `set -u`; a Ctrl-C prints what was read.
- [ ] **step 2/5: fake-curl test.** A fake `curl` on `PATH` feeds sentinel email, phone, address, name, id and key
  values for every part. Check: no sentinel appears on stdout or stderr, and the key is in no argv.
- [ ] **step 3/5: read the whole file** (orchestrator) and hand it over through the coordinator with the R1 account
  list and the browser step (spec section 9). THE KEY MOMENT.
- [ ] **step 4/5: the user runs R1, R2, R3, R4,** in the order and with the holdings of spec section 10. Outputs go to
  `memory/refs/bybit-probe-output-<date>.txt`. The date of `expiredAt` goes into the track HANDOFF and the run log as
  an open gap until R7 runs. R5, R6 only after Q1. R7 on that date.
- [ ] **step 5/5: write results into the spec.** `kiko:planner` turns each UNPROBED row into MEASURED or edits it; the
  same pass edits this plan. Check: `git grep -c UNPROBED` on the spec falls to the stage C and D rows; a kind that
  failed goes to its text in section 8. A shape change that reverses a row adds a was column. `make doc-suites`.

Gate per stage: set 3 starts after P1, P2, P11, P15, P16; its Earn step after P3. Set 5 after P4 to P7, P12, P13.

## 1.4-bybit set 2/10: neutral seams, Binance unchanged

Base: set 1 tip. Order: first code set. Size: about 250 code lines in 12 to 15 files, about 500 test lines. Tip: no
Bybit id, no visible change. Existing suites green unchanged except the re-pins of step 3/5 (no owed state added, no
1.2-upgrade seed moves). Reviewer checks: a Binance run writes byte-identical rows, marks and text; no behaviour moved
for `binance` or `btc_wallet`; each seam's red shown on the parent.

- [ ] **step 1/5: run the older-build restore (O10).** On this tip, before any id exists, a scratch test under
  `.superpowers/sdd/1.4-bybit/` (not committed to `src/`) restores a fixture file: a `bybit` account, `bybitAsset`
  holdings, `source: 'bybit'` rows, walk state, a `bybitCredentials` list. Check: restore passes, the account reads
  unsynced, no Keychain write for it. Output in the commit body and spec section 6.6. A failure stops the set and
  flips the decision: report it.
- [ ] **step 2/5: seam 2, `source` on the config.** `ExchangeWalkConfig` gains `source`; `PlacedWalletRow.source`,
  `placeWalletRows`; `BINANCE_WALK_CONFIG.source`. Files: `exchange/walk/walk-config.ts`, `exchange/walk/records.ts`,
  `binance/binance.walk-config.ts` and the tests that hand a config. Check: `npx jest` on those; Binance rows same.
- [ ] **step 3/5: `walk.ts` log tags to `[exchange sync]`** (5 sites). Re-pin `walk.test.ts`,
  `binance.history-walk.test.ts`, floor 6 expectations, naming O7. Grep every suite for the literal first.
- [ ] **step 4/5: seams 3, 4, 9: status per provider.** `captionWalksOf(provider)` in `binance-history-status.ts`,
  taking the provider, Binance's 8 unchanged, `btc_wallet` none. `hasExchangeHistory(provider)` and a tracked predicate
  per provider in `crypto-sync-section.component.tsx`. `accountDetail.untrackedCoins` takes `{{exchange}}` in en and uk;
  the output for Binance is byte-identical (pin it). Files: those, the locale files, section tests.
- [ ] **step 5/5: seams 7 and 1, plus shared extraction.** `scripts/checks/plist.sh` regex gains `X-BAPI-API-KEY`;
  row in `__tests__/plist-credential-detect.test.ts`. `ensureExchangeHoldings` reads an institution list,
  `isWalletHoldingInstitution`, holding `binance` only at this tip. `runExchangeWalkPlan` and `commitExchangeSpan`
  move to `exchange/walk/`, with `binance.walk-wiring.ts` their thin caller (consumer at this tip); `createWriteSerial`
  waits for its consumer in set 3. Check: Binance's walk suites unchanged; `npm run check:plist`; `npm run check:dup`.

## 1.4-bybit set 3/10: provider id, client, keys and balances (stage A core)

Base: set 2 tip. Needs P1, P2, P11, P15, P16; step 5/6 needs P3. Size: about 1,100 code lines in 20 to 24 files (under
the cap; `make mutable` measures), about 1,800 test lines. Tip: `bybit` in `balanceProviderIds`, every arm present, no
catalog row and no registry entry, so no way in (`syncJobsFor` skips an unwired id; pinned by the unwired-provider
guides). Reviewer checks: compliance items (pins, no-store, `hardenedFor`, no personal field parsed); retCode before
status; each refusal class; balance anti-goals; fixtures from the probe output, never real values.

- [ ] **step 1/6: host and pins.** `ios/Kiko/Info.plist` pin block (spec section 9), `.env.example`, `.env.test`, local
  `.env`, `src/env.d.ts` (`BYBIT_API_ENDPOINT`), `docs/security/README.md` table and host loop. Re-run the runbook's
  `openssl` line first. Check: `npm run check:plist`, `plutil -lint`.
- [ ] **step 2/6: client.** `bybit.endpoints.ts`, `bybit.client.ts`: `signedBybitGet` with the four headers and
  `no-store`, `fetchKeyInfo`, `fetchUnifiedBalance`, `fetchFundBalance`, the refusal table of spec section 4,
  `BybitRateLimitError`, `BybitRefusalError`. `bybit.cooldown.ts`. Check: rows A9, A10, A15; `npm run check:plist` now
  sees the client; `check:dup`.
- [ ] **step 3/6: Keychain.** `exchange/credentials`: `createWriteSerial`; `bybit.credentials.ts`: service
  `kiko.bybit.credentials`, username `bybit`, save, read, clear, clear-if-written. `accounts.repo.ts`
  `clearKeychainItems` (seam 6). `src/holdings/holding-metadata`: member `bybitAsset`. `ExchangeMetadataField` follows.
  Check: writer goes through `hardenedFor`; delete clears (seam 6 red); no secret in a log.
- [ ] **step 4/6: coins and keys.** `bybit.tracked-coin.ts` with `BYBIT_FIAT_CODES` re-read from the public
  `instruments-info` (spec rule 9), `bybit.holding-keys.ts`. Check: A8, property Q2 start.
- [ ] **step 5/6: balances.** `bybit.provider.ts` on the order of spec rule 3; `fetchEarnPositions` after P3 (if P3 shows
  no separate money, leave Earn out and take the spec's matching copy). Rows A1 to A7, A11, A31.
- [ ] **step 6/6: arms.** `balanceProviderIds`, `run-crypto-sync.ts` (`bybit` arm, join, no walks yet),
  `resync-request.ts`, `disconnect.ts`, `db/schema.ts` `source` list, `isWalletHoldingInstitution` gains `bybit` (seam 1
  red, real SQLite). Re-pin `provider.test.ts`, naming the Bybit id. Check: `make jest-affected`; tsc.

## 1.4-bybit set 4/10: expiry, `.kiko`, switch gate, account detail

Base: set 3 tip. Size: about 450 code lines in 12 to 14 files, about 900 test lines. Tip: text keys exist and render only
for a connected `bybit` account, which no path can create yet. Reviewer checks: every expiry state on every surface
against spec section 6.3; the switch gate cannot strand a Binance user; translator review of this set's keys.

- [ ] **step 1/4: key expiry state.** Patch kind `keyExpiry` in `exchange-state-patch.ts`, reader `keyExpiryOf` in
  `walk-state.ts` and `history-status`, `bybit.key-expiry.ts`, the provider's patch. Rows A14, A16, part of A26.
- [ ] **step 2/4: section surfaces.** The expiry line in `crypto-sync-section.component.tsx`, refusal texts in the
  provider (localized as Binance's), `bybitKinds` in the connected state, `bybitCoinBorrowed` beside `CoinLines`. Keep
  the section's complexity budget: split a small component. Check: section tests per state; A15.
- [ ] **step 3/4: `.kiko` entry (seam 5).** `payload.d.ts`, `is-export-secrets.ts`, `read-secrets.ts`,
  `restore-secrets.ts`, `import-data.screen.tsx` kinds. Re-pin the shape suites of seam map section 10 naming O10. No
  version bump. Check: A29, round trip. The quoted-name trap: read fields by property (`is-export-secrets` header).
- [ ] **step 4/4: switch gate (O11).** `conflictingExchangeHoldings`, `ConnectExchange`, `exchangeSwitchRefused`. Check:
  A28, Binance to wallet unchanged.

## 1.4-bybit set 5/10: cursor reader, budget and capital walk (stage B)

Base: set 4 tip. Needs P4, P5, P6, P11, P12, P13. Dropped if Q1 = A. Size: about 900 code lines in 7 to 9 files, about
1,600 test lines (split). Tip: the run arm reads deposits and withdrawals; still no way in. Reviewer checks: each early
return of spec section 5; settled matrix; no stored cursor; `withdrawType=2`; O6 sentinel; floors from P12.

- [ ] **step 1/4: budget and config.** `bybit.history-budget.ts` (`BybitLane`, caps 30 and 20, interval 1100,
  `createBybitHistoryRun`, refused call counted), `bybit.walk-config.ts` (`source: 'bybit'`, `bybitAsset`). Interval
  and caps may change only by P16 or P12, and the spec's section 5 changes with them.
- [ ] **step 2/4: `readCursorSpan`** (`bybit.cursor-span.ts`), at the `walkSpans` `read` seam: follows
  `nextPageCursor`, `canAfford` per page, `split` over a day, `undefined` at a day or less, repeat cursor or row outside
  `reach` is `bybit-page-drift`. No `readIdCursor` or `readSeriesSpan` stretch (O8). Rows A20, Q5 start.
- [ ] **step 3/4: parsers.** `bybit.history-client.ts`: tracked rule, unreadable, untracked counted never parsed, named
  fields only, `BybitHistoryParseError`, time units from P4, P5, P6. Paths added to `BYBIT_SIGNED_PATHS`.
- [ ] **step 4/4: the capital walk.** `bybit.capital-history.ts`: series `deposit`, `internal` (only if P5 passed),
  `withdraw`; windows 29 days; floor `now - 729 days` per P12; `reach`; removal of 70011; forward owes constant per the
  Transfer rule. Guard on an empty plan tests all four lists. Arm: `capital` in `logOnFailure`, `captionWalksOf('bybit')`
  gains `capital`. Rows A17 to A22, A27, A30.

## 1.4-bybit set 6/10: transfer walk and convergence proof (stage B)

Base: set 5 tip. Needs P7, P13. Dropped if Q1 = A. Size: about 500 code lines in 5 to 6 files, about 1,200 test lines.
Reviewer checks: pair id has one coin; wallet words closed; section 5 tables replaced with measured numbers.

- [ ] **step 1/3: `bybit.transfer-history.ts`**, 7-day windows, both legs, pair id from `bybit.holding-keys.ts`, unknown
  wallet owed. Arm and `captionWalksOf('bybit')` gain `transfer`. Rows A23 to A25, A26.
- [ ] **step 2/3: `bybit.keys.property.test.ts`, `bybit.convergence.test.ts`**, Q1 to Q7, run through real
  `planWalkPasses` and `runWalkPlan` with a fake route that serves the seeds, cut at every commit for the restart property,
  and added to `__tests__/property-sweep-sites.test.ts`. A red for Q3 shown by a mutant that drops a mark.
- [ ] **step 3/3: measured numbers.** Scribe writes the convergence table's MEASURED column into spec section 5. A cap that
  fails a seed's bound is a report to the orchestrator, never a loosened bound.

## 1.4-bybit set 7/10: the way in, shipped stage A+B (catalog last, O9)

Base: set 6 tip (set 4 tip if Q1 = A, and the A-only copy). Needs P1, P11 (boxes), the browser step (URL). Size: about 400
code lines in 14 to 18 files, about 700 test lines, plus policy and site pages. Tip: Bybit visible and complete. Merge:
only after the device check on this branch (PLANNER CALL 15). Reviewer checks: compliance section whole, each surface's
copy against spec section 8, help pins, the terms verdict; kiko:translator on every new key; `kiko:reviewer` on API terms.

- [ ] **step 1/5: credentials field.** Extract `ExchangeKeyForm` from `binance-credentials-field`, Binance's suite unchanged;
  new `bybit-credentials-field` over it, verifying through `fetchKeyInfo`, read-only refusal, `bybitConnectLimits` and
  `bybitKinds` before the inputs; `BYBIT_API_MANAGEMENT_URL` in the env files. Rows A12, A13.
- [ ] **step 2/5: wiring.** `exchange-catalog.ts` id and row before `other`, `exchange/registry/registry.ts` entry with
  `notListedKey`, `crypto-sync-form.component.tsx` arm, `crypto-sync-section.component.tsx` connect callback,
  `account-form.screen.tsx` and `use-connect-reminder.ts` per-provider props, `clearPairIfRowMissing` for Bybit. Re-pin
  `exchange-catalog.test.ts`, `registry.test.ts`, `crypto-sync-section.component.connect.test.tsx`, naming O9.
- [ ] **step 3/5: help.** Grep the help pins, `en.casing-by-role`, and uk first; in ONE step edit `help-topics.ts` (a sixth
  step key), en, uk, `help-topics.test.ts` (count 6, step 3 still Binance). The keys of steps 4 and 5 move: per
  harness-workflow "Removing or renaming a catalogue key", every dependent edit stays in this step.
- [ ] **step 4/5: privacy.** Policy text of spec section 9 in `docs/privacy-policy.en.md`, `docs/privacy-policy.md`, site
  rebuilt under `docs/privacy-site/`, `scripts/privacy-site.js` `NON_REQUEST_HOSTS`, `bybit.privacy-policy.test.ts` per path.
  Check: `npm run privacy:site check`, uk apostrophe suite.
- [ ] **step 5/5: device check, user on device.** Build from this branch. Each kind against the small account, each surface
  in section 6.4; expiry line; a wrong key; a read-write key; disconnect and reconnect; Binance still syncs; light and dark.
  Positive and negative pin checks of `docs/security/README.md`. The coordinator owns device builds. Pass: merge.

Stop here if Q1 = A or A+B: sets 8 and 9 are not built in 1.4.

## 1.4-bybit set 8/10: stage C, log and convert (outline; detail after the user's Q1)

Needs P8, P9 (R5). Expected: new `WALK_IDS` member `log` with its fan-out (`walk-state.test.ts` and siblings), not-imported
kind, allowlist of seen `type` values, `convert` walk or read, double-read rule. Size floor: 800 code lines, under 15 files.
Copy edits in the same set. Reviewer: nothing parsed outside the allowlist; a trade never counted twice.

## 1.4-bybit set 9/10: stage D, Earn orders and yield (outline; detail after the user's Q1)

Needs P10 (R4, R6). Expected: `earn` walk id, flexible orders, yield per category, floor `now - 90 days`, own lane under the
gate. Size floor: 500 code lines, under 10 files. Reviewer: what the 3-month floor drops, stated in copy.

## 1.4-bybit set 10/10: skill drift

Base: the last built set. Size: skill and agent text only. Reviewer: `make doc-suites`.

- [ ] **step 1/2:** `kiko:retrospect` verifies `.claude/skills/`, `harness/kiko/skills/`, `harness/kiko/agents/` against the
  code.
- [ ] **step 2/2:** `kiko:scribe` adds a "Bybit" section to `kiko-exchange-sync`, updates kiko-compliance (the terms verdict,
  pins), kiko-domain (registry) and kiko-architecture (`.kiko` secrets), and commits. The report names the sha.

## Merge order

The coordinator merges into `next`: 2, 3, 4, 5, 6, then 7 after its device pass, then 10. With Q1 = A: 2, 3, 4, 7, 10. With
C or D: 8 and 9 each after 7, each with its own device check, before 10. Set 1 merges nothing but its spec edit. Each merge
needs a queued verify green on the merged tip. `1.4-light-scheme` may land first: theme tokens keep sets 4 and 7 unaffected.

## Sizes

| Set | Code lines (about) | Code files | Test lines (about) |
|---|---|---|---|
| 1 | script 600-900 | 1 | 1 fake-curl test |
| 2 | 250 | 12-15 | 500 |
| 3 | 1,100 | 20-24 | 1,800 |
| 4 | 450 | 12-14 | 900 |
| 5 | 900 | 7-9 | 1,600 |
| 6 | 500 | 5-6 | 1,200 |
| 7 | 400, plus copy and policy | 14-18 | 700 |
| 8 | outline, 800 | under 15 | outline |
| 9 | outline, 500 | under 10 | outline |
| 10 | docs | | |

A duration for any of these comes from `kiko:estimator`.

## Self-review

Spec coverage: a section 1, b 2, c 3, d 5, e 6, f 7, g 8, h 9, i 10, j 11. O1 to O12 hold: O1, O2 set 7 and 3; O3 set 3 step 2;
O4 set 3 step 4; O5, O6 set 5 step 3 and set 7 copy; O7 set 2; O8 set 5 step 2; O9 set 7; O10 set 2 step 1 and set 4 step 3;
O11 set 4 step 4; O12 global.
