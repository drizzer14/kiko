# 1.4-bybit: Bybit sync implementation plan, sets 1/8 to 8/8

> For agentic workers: use superpowers:subagent-driven-development. Steps use `- [ ]` tracking.

**Goal:** Bybit balances and history rows from a read-only key, visible and complete at each stage, with nothing that needs the user's money (O62). Rows rest on the live API docs ("docs only"); balances rest on an empty mainnet read and a testnet run.

**Architecture:** A new `src/crypto-sync/bybit/` beside `binance/`, on the shared walk. Seams 1, 2 and 7 get
parameters first; the provider id and core follow with no way in from the UI, seams 3, 4 and 9 change with the id, and
the catalog entry goes last.

**Spec:** `docs/superpowers/specs/2026-11-03-bybit-sync-design.md`. Section numbers below are the spec's. Plan
text never overrides it; a difference found is reported.

**Status:** O62 (2026-11-04) changed the scope after the approval of O41 and O59: "I can't spend money testing what's
already covered by api documentation, so implement what you can without relying on my money". R1 and the second key ran,
and their results are written (O60). R2 to R4 with real money are off: later, no date, the user's choice (spec Backlog). Set 2 bases
on the set 1 tip, which is the commit of this text (PLANNER CALL 33; was: after R3 and R4, O36). The
terms verdict is in spec section 9: PASS WITH CONDITIONS for global accounts. The user accepted the
5.2.2 and 6.5 doubts: keep Bybit, global
accounts only, no letter to Bybit (O42). The user answered Q1 to Q4 (spec section 13):
stages A and B ship, and stages C and D are deferred under Backlog (O37, O62); no notification; the two gaps are accepted;
1.4 ships before R7, with the copy of O26. Q5 is open with the user: if the answer is not A, sets 5 and 6 change. Mutation gates are paused by the user since 2026-10-25: verify and review only;
the gate text stays below for when it is lifted.

## Global constraints

- Base 57130e23c at this writing; each set's base is the tip of the set before it. Every code fact is a symbol or
  anchor text: re-grep it on the actual base. Every count is a FLOOR measured at 57130e23c; the developer measures.
- Commit granularity: per step, one `kiko:qa` RED commit showing the failing output on the parent, then one
  `kiko:developer` GREEN commit. A message names `1.4-bybit set N/8 step n/m`. A re-pin names the ruling that forces
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
  verifies, scribe fixes) unless the orchestrator folds it into set 8; the report names the drift sha or "no drift".
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

## 1.4-bybit set 1/8: the terms verdict, the probe script and the user's probe run

Base: 57130e23c, plus this spec. Steps 1/10 to 7/10 are done (O39, O59, O60, and this text). Steps 8/10 to 10/10
are next (O62); only set 3 step 7/7 and set 7's Earn clause wait for them.
Size: 1 script, 1,379 lines measured 2026-11-04, plus the host choice of step 8/10, 1 test, no app file.
Not mutable.
Reviewer checks: the whole script for any leak path; every part against spec section 10; no write verb. "Set 1 tip" is
the commit of step 7/10, this text (PLANNER CALL 33; was: the commit after the second results run, O36). Set 2 bases on it.

The user's order (O23, O31, O38, O39, O41, O62): part 1 of the browser step (step 1/10, done), the terms verdict (step 2/10,
done), the user's spec approval (done, O59), R1 and the second key (step 6/10, done), the empty mainnet read and the testnet
run (step 9/10), and R7 on 2027-02-05 or later (O55, O60), an open check after the ship (Q4).

- [x] **step 1/10: part 1 of the browser step, DONE 2026-11-03** (O39; PLANNER CALL 18). The coordinator read both pages in the
  Orca browser at the user's word. No login was needed. The text is in `memory/refs/bybit-terms-2026-11-03/`.
- [x] **step 2/10: the terms verdict, DONE 2026-11-03** (O23, O39). PASS WITH CONDITIONS for global accounts, by a
  `kiko:reviewer`; `.superpowers/sdd/1.4-bybit/terms-verdict.md`. The stop rule did not fire. It went into spec section 9
  with `make doc-suites`. C1 to C5 and C7 are spec section 9 rows, and each step that holds one names it below. C6 is the user
  line of spec section 10.
- [x] **step 3/10: write `memory/refs/bybit-probe.sh`, DONE 2026-11-04, with fix round 4** (main checkout, untracked, like its
  templates; `kiko:ops` or the coordinator names the writer). Pattern: `binance-transfer-depth-probe.sh`, `eodhd-verify.sh`: hidden prompts,
  `curl -q --noproxy '*' -K -` with URL and key on stdin, perl HMAC with the secret on stdin, alnum-checked key, masked URLs. Parts
  P1 to P7 and P11 to P18, no others (O37), with P14 NOT RUN and no call (O49). The printer of spec section 10: no server text, a
  `retCode` with a word from a closed table (O45), a value from a closed list per field, and `<other>` for an unknown value (O46);
  a coin name, a `permissions` name and a wallet-hint value keep a shape test, the accepted residual of spec section 10 (O51).
  P4 and P6 read two balances around the user's step (O47); P2 and P3 hold K3, K4, K5 and K11 at prompts (O50), with P3's stake
  check on amounts (O54); P13 tests the filter time field on the withdrawal series (O48); P17 asks for a renewal only when the
  key may really have expired: an ok from any of its first three calls prints "not expired yet" and ends with no prompt, and the
  `query-api` answer stops it on HTTP other than 200 or 401, on HTTP 200 with no `retCode`, and on 10002, 10004 and 10016 (O55,
  O57). `set -u`; a Ctrl-C prints what was read. No elapsed time is printed, and no
  call repeats to measure uptime or latency (C6, API 6.6).
- [x] **step 4/10: fake-curl test, DONE 2026-11-04.** A fake `curl` on `PATH` feeds sentinel email, phone, address, name, id and key
  values for every part. Check: no sentinel appears on stdout or stderr, the key is in no argv, and each part stays under a
  maximum number of calls per part, with `CALL_CAP` as the hard cap (C6, O53). The script has no
  limit variable per part. The maximum per part follows from the code, with no paging loop: P1 1,
  P2 3, P3 8, P4 6, P5 1, P6 5, P7 2, P11 9, P12 16, P13 42, P14 0, P15 3, P16 9, P17 6, P18 8. The
  test pins exact counts per run and for some parts alone, and runs a `CALL_CAP` variant (O58).
  Result: `memory/refs/bybit-probe.test.sh` printed
  "4673 passed, 0 failed", exit 0 (re-run by the orchestrator on 2026-11-04 with /bin/bash 3.2.57 and jq 1.7.1-apple).
- [x] **step 5/10: read the file and hand it over, DONE 2026-11-04** (orchestrator, then
  coordinator). Was: "read the whole file. The reviewer
  passes it." The reviewer did not pass it: three reviews each gave FIX FIRST (17, 9 and 6 findings), and O56 stopped the chain after
  fix round 4 with no fourth review. O56 replaces that pass. Done under O56: the orchestrator
  read the round 4 diff and the whole final script on 2026-11-04 with no blocking defect (a read,
  not a review; O58), and the test of step 4/10 passed. The user's spec approval is given, DONE
  2026-11-04 (O41, O59). The handover was confirmed by the coordinator. Part 2 of the browser step is DONE (O60).
- [x] **step 6/10: R1 and the second key, DONE 2026-11-04** (O60): 46 and 10 calls, output lines 1 to 158 and 159 to 215 of
  `memory/refs/bybit-probe-output-2026-11-04.txt`. The second key is deleted (O61 (c)). The first key stays in the user's password
  manager until R7, on 2027-02-05 or later (O55): an open check after the ship (Q4), which holds neither set 7 nor the merge, with its
  row UNPROBED(P17) and the copy of O26. Was: this step also held R2, R3 and R4 with real money; they are under the spec's Backlog (O62).
- [x] **step 7/10: write results into the spec, first run, DONE by this commit.** R1 and the second key are MEASURED;
  docs-only rows, safe readings and clauses are written (O60, O62). Check: `make doc-suites`. This commit is the set 1 tip.
- [ ] **step 8/10: the host choice in the script.** Owner: `kiko:developer`, from spec section 10, "The testnet run". Files:
  `memory/refs/bybit-probe.sh`, `memory/refs/bybit-probe.test.sh`, both in the main checkout, untracked. First argument
  `--testnet`, a closed choice of two hosts, default byte-identical; `--testnet R7` refused before the key prompt; header, key prompt, P1's host line
  and usage name the host. Check: the test pins each call's host per run and passes with `/bin/bash` and jq, as step 4/10 did. A reader
  reads the diff; O56 keeps its stopping rule.
- [ ] **step 9/10: the user's reads, no money.** Mainnet: `R2 P2`, then `R4 P3` with `skip`. Testnet: the six steps of spec section 10, each
  with its proof. Outputs: `memory/refs/bybit-probe-output-<date>.txt` for mainnet, `memory/refs/bybit-probe-testnet-output-<date>.txt` for
  testnet. If the account step fails or a step is refused: the coordinator takes the question to the user; the table in spec section 10 says what each
  refusal means. It blocks only set 3 step 7/7 and the Earn clause.
- [ ] **step 10/10: write those results.** `kiko:planner`: the P2 and P3 rows to MEASURED with "on testnet" stated, the clause by "What proves
  Earn", the `locked` row, or the question to the user. Check: `git grep -c UNPROBED` on the spec falls to P17, deferred rows under Backlog, the record
  rows of section 12, and any row of P2 or P3 whose step was refused (O35). A was column where a shape reverses a row. `make doc-suites`.

Gate per stage: every code set bases on the set 1 tip or later, so P1, P11, P12, P13 (edges), P15, P16 and step 2/10 hold at each of them.
No code set needs R2 to R4 (O62). Set 3 step 7/7 needs step 10/10. P14 holds nothing: it makes no call (O49).

## 1.4-bybit set 2/8: neutral seams, Binance unchanged

Base: set 1 tip. Order: first code set. Size: about 210 code lines in 9 to 12 files, about 450 test lines (was 280, 13
to 16, 650: O30 moves seams 3, 4 and 9 to set 3). Tip: no Bybit id, no visible change. Merges alone (O21). At this set,
existing suites stay green unchanged except the re-pins of step 3/4 (no owed state added, no 1.2-upgrade seed moves); set 3
step 6/7 re-pins the status suites' calls (O30). Reviewer checks: a Binance run writes byte-identical rows, marks and text;
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

## 1.4-bybit set 3/8: provider id, client, keys and balances (stage A core)

Base: set 2 tip. Needs step 2/10 of set 1 and P1, P11, P15, P16, all MEASURED. Steps 1/7 to 6/7 need no user step: coin-row fixtures use the page samples,
and the empty read when it exists. Step 7/7 needs step 10/10 of set 1. Was: P2 and P3 with the `R4 P3` run around the redeem (O62). Size:
about 1,270 code lines in 25 to 29 files (under the cap of 30; `make mutable` measures, and a count over the cap is a
report to the orchestrator), about 2,350 test lines (was 1,200, 21 to 25, 2,050: O30 moves seams 3, 4 and 9 here; O31, O33
add rows; O29 moves the policy, its site pages and `bybit.privacy-policy.test.ts` to set 7; O39 adds A52, A53, A56; O62 adds A58, A62 and moves no count). Tip before step 7/7: Earn is not read, and clause "E2 and E4" is true. Tip: `bybit` in
`balanceProviderIds`, every arm present, no catalog row and no registry entry, so no way in (`syncJobsFor` skips an
unwired id; pinned by the unwired-provider guides). Stays out of `next` (O21). Reviewer checks: compliance items (pins,
no-store, `hardenedFor`, no personal field parsed); C2 and C5 (no write path, no server copy, no shared key in the build);
retCode before status; each refusal class; balance anti-goals; fixtures from the probe output, never real values; every
Binance caption result the same after the re-pins.

- [ ] **step 1/7: host and pins.** `ios/Kiko/Info.plist` pin block (spec section 9), `.env.example`, `.env.test`,
  local `.env`, `src/env.d.ts` (`BYBIT_API_ENDPOINT`), `docs/security/README.md` table and host loop. Re-run the runbook's
  `openssl` line first. The policy step is set 7 step 4/6 (O29). Check: `npm run check:plist`, `plutil -lint`.
- [ ] **step 2/7: client.** `bybit.endpoints.ts`, `bybit.client.ts`: `signedBybitGet` with the four headers and
  `no-store`, `fetchKeyInfo` (with `readOnly`, `isMaster` for set 7; `permissions` stays unread), `fetchUnifiedBalance`,
  `fetchFundBalance`, the refusal table of spec section 4, `BybitRateLimitError`, `BybitRefusalError`. `bybit.cooldown.ts`.
  `BYBIT_SIGNED_PATHS` in `bybit.endpoints.ts`, a path added in each later step that adds a route, with its literal in
  `bybit.endpoints.test.ts` (C2). Check: rows A9, A10, A15, A52 (C1: the host, and no tracked file names `api-testnet`), A53 (C2: GET only, a closed list), A62;
  `npm run check:plist` now sees the client; `check:dup`.
- [ ] **step 3/7: Keychain.** `exchange/credentials`: `createWriteSerial`; `bybit.credentials.ts`: service
  `kiko.bybit.credentials`, username `bybit`, save, read, clear, clear-if-written. `accounts.repo.ts`
  `clearKeychainItems` (seam 6). `src/holdings/holding-metadata`: member `bybitAsset`. `ExchangeMetadataField` follows.
  Check: A56 (C5: writer goes through `hardenedFor`); delete clears (seam 6 red); no secret in a log.
- [ ] **step 4/7: coins and keys.** `bybit.tracked-coin.ts` with `BYBIT_FIAT_CODES` re-read from the public
  `instruments-info` (spec rule 9), the list stays the 5 codes (O19), `bybit.holding-keys.ts`. The tracked predicate
  `isTrackedBybitAsset` is written here; step 6/7 wires it to the section. Check: A8, A38, property Q2 start.
- [ ] **step 5/7: balances, UNIFIED and FUND.** `bybit.provider.ts` on the order of spec rule 3, reading `walletBalance` (PLANNER CALL 32). Patch kind
  `balanceNotes` in `exchange-state-patch.ts` for the refused wallets, borrowed coins and Earn left-out count, per wallet, on the
  `oversizedBalance` and `complete` precedent: a wallet that this run read replaces its notes, and a wallet that failed
  keeps them, plus its refused mark on a 10005 (O33, PLANNER CALL 17). The `balanceSyncedAt` stamp, so an empty account shows Last sync. Rows A1,
  A2, A5 to A7, A11, A31, A34 (state part), A46 (provider part), A48, A58.
- [ ] **step 6/7: the `bybit` id, arms, seams 3, 4, 9 and the Bybit tracked predicate (O30).** Red first with the real id,
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
- [ ] **step 7/7: Earn, WAITS for set 1 step 10/10.** `fetchEarnPositions`, by spec rule 46 and "What proves Earn": a row with a `status`
  needs the allowlist, a row with none adds its `amount` (O31). Clause E3: no Earn read, and the money is in the balance; clause E2: FlexibleSaving only;
  clause E4: OnChain only; "E2 and E4": this step writes no code, and the balance-note count leaves. Rows A3, A4, A36, A37, A47, whichever the outcome keeps.
  `BYBIT_SIGNED_PATHS` gains `/v5/earn/position` only if a category ships. If the `locked` reading came back outside `walletBalance`, the question
  returns to the user first (spec section 10), and this step adds nothing for it until the answer. Any later set may land before this step; the batch merge may not.

## 1.4-bybit set 4/8: expiry, `.kiko`, switch gate, account detail

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

## 1.4-bybit set 5/8: cursor reader, budget and capital walk (stage B)

Base: set 4 tip. Needs the live pages of spec section 3, and P11, P12, P13 (edges), MEASURED. Was: P4, P5, P6 with real money (O62). Size: about 1,000 code lines in 7 to 9 files, about 1,900 test lines, split (was 950, same, 1,750: `depositType`, the time unit, two reach rules, A60, A61). Fixtures take the page samples. Tip: the run arm reads deposits and withdrawals; still no
way in. Stays out of `next` (O21). Reviewer checks: each early return of spec section 5; settled matrix; no stored cursor;
`withdrawType=2`; O6 sentinel; the floor stays 729 days (R1); rules 45 and 47, and each safe reading of spec section 3 against the page.

- [ ] **step 1/4: budget and config.** `bybit.history-budget.ts` (`BybitLane`, caps 30 and 20, interval 1100,
  `createBybitHistoryRun`, refused call counted), `bybit.walk-config.ts` (`source: 'bybit'`, `bybitAsset`). P16 and
  P12 are MEASURED, and the interval and caps stay (spec section 5).
- [ ] **step 2/4: `readCursorSpan`** (`bybit.cursor-span.ts`), at the `walkSpans` `read` seam: follows
  `nextPageCursor`, `canAfford` per page, `split` over a day, `undefined` at a day or less; a repeat cursor, or a row outside the span
  by both readings of its window field, is `bybit-page-drift` (rule 22, PLANNER CALL 29); an empty or absent cursor, or a page with no row, ends the span; a pending row with no time is never drift, and the time sort leaves it out (rule 19,
  rule 47). No `readIdCursor` or `readSeriesSpan` stretch (O8). Rows A20, A61, Q5 start.
- [ ] **step 3/4: parsers.** `bybit.history-client.ts`: tracked rule, unreadable, untracked counted never parsed, named
  fields only (the list of each series in spec section 3: `result.rows`, and `result.list` for transfer), `BybitHistoryParseError`, time by digit count: 13 ms, 10 seconds, any other unreadable and owed (A60); an empty, 0 or absent time reads the same (rule 47). Paths added to `BYBIT_SIGNED_PATHS`.
- [ ] **step 4/4: the capital walk.** `bybit.capital-history.ts`: series `deposit`, `internal`,
  `withdraw`; windows 29 days; floor `now - 729 days`, which P12 did not move (R1); `reach` per rule 18;
  a withdrawal's `extentOf` is `createTime` alone (PLANNER CALL 29); `depositType` 0 only (PLANNER CALL 30); removal of 70011; forward owes constant per the
  Transfer rule, holding each code of a waiting status with a time. Every row on FUND, clause W1 (rule 45). The walker stays as it is: a pending row with
  no time makes no row and owes nothing (rule 47, PLANNER CALL 28). Guard on an empty plan
  tests all four lists. Arm: `capital` in `logOnFailure`, `captionWalksOf('bybit')` gains `capital`. Rows A17
  to A22, A27, A30, A35, A39, A41, A60. A failing proof of a safe reading is a report to the planner, never a loosened row.

## 1.4-bybit set 6/8: transfer walk and convergence proof (stage B)

Base: set 5 tip. Needs the live pages and the transfer path (MEASURED). Was: P7, P13 with rows (O62). Size: about 500 code lines in 5 to 6 files, about 1,300 test lines (was 1,200: A57).
Stays out of `next` (O21). Reviewer checks: pair id has one coin; wallet words closed; section 5 tables replaced with
measured numbers.

- [ ] **step 1/3: `bybit.transfer-history.ts`**, 7-day windows, both legs, pair id from `bybit.holding-keys.ts`, unknown
  wallet owed. Arm and `captionWalksOf('bybit')` gain `transfer`. Rows A23 to A25, A26.
- [ ] **step 2/3: `bybit.keys.property.test.ts`, `bybit.convergence.test.ts`**, Q1 to Q7, run through real
  `planWalkPasses` and `runWalkPlan` with a fake route that serves the seeds, cut at every commit for the restart property,
  and added to `__tests__/property-sweep-sites.test.ts`. A red for Q3 shown by a mutant that drops a mark. A57: the fake route serves each window field in turn.
- [ ] **step 3/3: measured numbers.** Scribe writes the convergence table's MEASURED column into spec section 5. A cap that
  fails a seed's bound is a report to the orchestrator, never a loosened bound.

## 1.4-bybit set 7/8: the way in, shipped stage A+B (catalog last, O9)

Base: set 6 tip. Needs P1, P11 and the URL of part 2, all done, and set 3 step 7/7's outcome for the Earn clause (no outcome: "E2 and E4"). Size:
about 480 code lines in 17 to 21 files, about 1,000 test lines (was 450, 16 to 20, 950: PLANNER CALLS 25 and 27; O29 moves `bybit.privacy-policy.test.ts`
here; O39 adds A51, A54, A55), plus the policy and site pages (O29). Tip: Bybit visible and complete. Merge: the batch of
"Merge order", only after the device check on this branch (PLANNER CALL 15). That check, step 6/6, is "fundamentals done" (O44).
Reviewer checks: compliance section whole, each
surface's copy against spec section 8, help pins, the policy text against spec section 9; C4's wording (no Bybit look, no line
that offers Kiko in place of the Bybit app) and C3 (no price, ad, IAP, tip or sponsor), both by judgment; kiko:translator on
every new key.

- [ ] **step 1/6: credentials field.** Extract `ExchangeKeyForm` from `binance-credentials-field`, Binance's suite unchanged;
  new `bybit-credentials-field` over it, verifying through `fetchKeyInfo` and one real read of each shipped route, 7 calls, 9 with Earn; refusals in the order of spec section 6.8 (O13, PLANNER CALL 25), all before any Keychain write; `bybitConnectLimits` and `bybitKinds` before the
  inputs; `BYBIT_API_MANAGEMENT_URL` = https://www.bybit.com/en/app/user/api-management in the env files, and `www.bybit.com` in `scripts/privacy-site.js` `NON_REQUEST_HOSTS`
  in this same step. Rows A12, A13, A32, A33, A54 (C3: the exact URL). `bybitConnectLimits` and `bybitKeyRejected` carry the C1
  text. Check: `npm run privacy:site -- hosts` does not list `www.bybit.com`.
- [ ] **step 2/6: wiring.** `exchange-catalog.ts` id and row before `other`, `exchange/registry/registry.ts` entry with
  `notListedKey`; an optional registry field that `ExchangeHistoryFooter` reads for `earlierHistory`, set on Binance only, so its line stays byte-identical (PLANNER CALL 27, A59); `crypto-sync-form.component.tsx` arm, `crypto-sync-section.component.tsx` connect callback,
  `account-form.screen.tsx` and `use-connect-reminder.ts` per-provider props, `clearPairIfRowMissing` for Bybit. Re-pin
  `exchange-catalog.test.ts`, `registry.test.ts`, `crypto-sync-section.component.connect.test.tsx`, naming O9. Row A43,
  red on the parent, where `bybit` has neither entry (O21). Row A55 (C4: the caption). The footer of `notListedKey` carries the
  C1 text.
- [ ] **step 3/6: help and shipped copy.** Grep the help pins, `en.casing-by-role`, and uk first; in ONE step edit
  `help-topics.ts` (a sixth step key), en, uk, `help-topics.test.ts` (count 6, step 3 still Binance). The keys of steps 4 and
  5 move: per harness-workflow "Removing or renaming a catalogue key", every dependent edit stays in this step. The step text
  ends with the shipped `bybitKinds` text, and it carries the C1 text. `bybit.shipped-copy.test.ts`, one row per kind set (O15).
  Rows A40, A51 (C1: the four surfaces, en and uk).
- [ ] **step 4/6: the policy (O29, O24, O15, O34).** The block and the section 3 intro of spec section 9, with the variant
  that fits the shipped kind set, in `docs/privacy-policy.en.md`, `docs/privacy-policy.md`, site rebuilt under
  `docs/privacy-site/` (`npm run privacy:site -- build`); only the shipped paths in `BYBIT_SIGNED_PATHS` (O15);
  `bybit.privacy-policy.test.ts` on those paths. Effective date: bump it in this edit; the publish re-dates it to the
  publish day if gh-pages goes out later (release skill, "Privacy policy check"). Check: A44, A50, uk apostrophe suite. The
  live `npm run privacy:site -- check` runs at publish only, before the upload, not on this tip.
- [ ] **step 5/6: App Review notes and kit section D (O22).** Owner: `kiko:release`, because the kit
  (`memory/refs/resubmission-kit.md`) is outside the repository; the coordinator runs it. Per kiko-compliance's "reviewer
  notes must supply it or say how to get it": the notes name Bybit, what it reads, the user's own key and how to get one,
  and the HTTP 403 on a US IP with `bybitForbidden`. Per its "does the dataset show it?": state whether the demo `.kiko` shows
  Bybit, with the reason. Kit section D gains the App Privacy line. C4: no Bybit in the store title, subtitle or keywords, and
  no Bybit logo in the store metadata. Check: the coordinator reads both texts and the store metadata against spec section 9; no
  app file changes.
- [ ] **step 6/6: device check, user on device, two builds (PLANNER CALL 34, spec section 10).** The coordinator owns device builds.
  First, scratch: a scratch clone of this tip, with `BYBIT_API_ENDPOINT` set to testnet in its own untracked `.env`, never a `src/` edit. If Flexible Savings
  ships, the user subscribes again on testnet first, because K11 redeemed it (PLANNER CALL 22). Coin rows on Unified and Funding, a balance moving, Earn if it ships, one transfer if K2 ran. Then the
  scratch app leaves the device. Then real: this tip, `make deploy EXPECT=api.bybit.com`; the empty account with Last sync; the expiry line with 2027-02-04; each surface
  in section 6.4; a wrong key; a read-write key; a key refused on a route (a narrow key, made and deleted by the user, optional); disconnect and reconnect;
  Binance still syncs; light and dark. Positive and negative pin checks of `docs/security/README.md`. Guard: `.env` is in `.gitignore`, the worktree's `.env` never changes, and A52
  pins that no tracked file names `api-testnet`. This check is "fundamentals done" (O44), the next device call for Bybit. It proves the connect path, the expiry, balances from a live answer and every
  stated limit. It does not prove a coin row on mainnet, or any deposit or withdrawal row, which no build can show: those are the accepted residuals of spec section 10. If the
  testnet account step failed, only the real build runs, and the report says that no coin row was seen. A defect in data, a stated limit or a
  condition blocks it. A visual wish does not block it: it goes to fast visual rounds after it, on this branch, before the batch
  merge. Pass: those rounds, then the batch merge. A stop here: sets 3 to 7 stay out of `next`, and no removal row is needed.

## 1.4-bybit set 8/8: skill drift

Base: set 7 tip. Size: skill and agent text only. Reviewer: `make doc-suites`.

- [ ] **step 1/2:** `kiko:retrospect` verifies `.claude/skills/`, `harness/kiko/skills/`, `harness/kiko/agents/` against the
  code.
- [ ] **step 2/2:** `kiko:scribe` adds a "Bybit" section to `kiko-exchange-sync`, updates kiko-compliance, kiko-domain (registry)
  and kiko-architecture (`.kiko` secrets), and commits. The report names the sha. In kiko-compliance, "Third-party trademarks":
  - A dated Bybit block like the Binance one (C7): the verdict of 2026-11-03 with its documents and dates, the clauses that
    matter (API 6.5, 6.7, 6.9, Global 40.4(e), EU 7.4), the pins, and standing items for C1 to C5, each with its test.
  - C7's re-read: API Terms sections 1 and 2.1, the API Documentation (API 7.1) and the EU 4.3.7 list, at each release that
    changes Bybit. 1.4 is the first. A `kiko:reviewer` does it before the block goes in. A page it cannot read is named as unread
    in the block. A clause that forbids this use goes to the coordinator for the user before the upload (the stop rule, O23).
  - A 5.2.2 item, from the compliance finding: the 5.2.2 and 6.5 doubts stay open and are accepted by the user, 2026-11-03, with
    no letter to Bybit (O42, spec section 9). A change to the scope of Bybit re-opens the item.

## Merge order

A recommendation to the coordinator, who owns the merge (O21). Sets 3 to 7 stay out of `next` until set 7 passes on device,
then merge as one batch, so no dormant reader reaches `next`. If set 7 stops, no removal row is needed; set 2 holds no Bybit
id and may stay. The cost is one larger merge.

The device pass is "fundamentals done" = set 7's device check, step 6/6 (O44). Fast visual rounds come after it, on set 7's branch,
before the batch merge; a visual wish does not block the pass, and a defect in data, a stated limit or a condition does.

Order into `next`: 2 alone; then the batch 3, 4, 5, 6, 7 after the device pass and the visual rounds; then 8. O62 removes no set and changes no order: it removes
the wait for R2 to R4 before set 2, so set 2 can merge now. The batch holds set 3 step 7/7, or clause "E2 and E4" when no testnet reading exists. Nothing ships hidden at any merge (2.5.19): set 2 has no id,
and the way in comes last.

Set 1 merges nothing but its spec edit. Each set tip has its queued verify, and the merged tip of each merge has a queued
verify green. `1.4-light-scheme` may land first: theme tokens keep sets 4 and 7 unaffected.

## Sizes

| Set | Code lines (about) | Code files | Test lines (about) |
|---|---|---|---|
| 1 | script 1,379, measured, plus the host choice | 1 | 1 fake-curl test |
| 2 | 210 | 9-12 | 450 |
| 3 | 1,270 | 25-29 | 2,350 |
| 4 | 550 | 13-15 | 1,050 |
| 5 | 1,000 | 7-9 | 1,900 |
| 6 | 500 | 5-6 | 1,300 |
| 7 | 480, plus copy, the policy and site pages | 17-21 | 1,000 |
| 8 | docs | | |

A duration for any of these comes from `kiko:estimator`.

## Self-review

Spec coverage: a section 1, b 2, c 3, d 5, e 6, f 7, g 8, h 9, i 10, j 11. O1 to O12 hold: O1, O2 set 7 and 3; O3 set 3 step 2;
O4 set 3 step 4; O5, O6 set 5 step 3 and set 7 copy; O7 set 2; O8 set 5 step 2; O9 set 7; O10 set 2 step 1 and set 4 step 3;
O11 set 4 step 4; O12 global. O13 to O28: O13 set 3 steps 2, 5, set 4 step 2, set 7 step 1; O14 set 1 step 6, set 5 step 4;
O15 set 3 step 5, set 7 steps 3, 4; O16 set 1 step 6 (words corrected by O32); O17 set 3 step 6 (double replaced by O30); O18
set 3 step 5; O19 set 3 step 4, spec backlog; O20 set 1 step 7, set 5; O21 global, set 7 step 2, "Merge order" (policy sentence
reversed by O29); O22 set 7 step 5; O23 set 1 steps 1, 2; O24 set 7 step 4; O25 spec section 8, set 7 step 3; O26 set 4 step 2,
Q4; O27 set 3 step 5, set 4 step 2; O28 set 2 step 3. O29 to O36: O29 global, set 3 step 1, set 7 steps 1, 4; O30 set 2 header,
set 3 steps 4, 6; O31 set 1 step 6, set 3 step 5, set 7 step 6, spec sections 8, 9, 10; O32 set 1 steps 6, 7, set 5 steps 2, 3,
4; O33 set 3 step 5; O34 set 7 step 4, spec section 9; O35 set 1 step 7; O36 set 1 header, step 2. O37 (replaces O36's merge row and set 7 stop line): the set list, set 1 steps 3, 6, 7,
"Merge order", Backlog below, spec sections 3, 5, 6.4, 8, 9, 10, 12, 13, Backlog. O38 set 1 header, steps 1, 2, 5, spec sections 9,
10. O39 set 1 steps 1 to 6, set 3 steps 2, 3, set 7 header, steps 1, 2, 3, 5, set 8 step 2, spec sections 1, 6.1, 6.2, 8, 9, 10,
11, 12, 13. O40 set 1 step 6, spec sections 10, 12. O41 status, set 1 header, step 5, spec sections 10, 12. C1 set 3 step 2, set 7
steps 1, 2, 3; C2 set 3 step 2; C3 set 7 header, step 1, set 8 step 2; C4 set 7 header, steps 2, 5; C5 set 3 header, step 3; C6 set
1 steps 3, 4, 5, 6, spec section 10; C7 set 8 step 2. O42 status, set 8 step 2, spec sections 9, 12, 13. Q1 to Q4: spec sections 6.3, 7, 13, set 1 step 6.
O44 set 7 header, step 6, "Merge order". O45, O46 set 1 step 3, spec sections 10, 12. O47 set 1 steps 3, 6, spec rule 41, sections
10, 12. O48 set 1 steps 3, 6, 7, spec sections 10, 12. O49 set 1 step 3, gate per stage, spec sections 8, 10, 12. O50 set 1 steps 3,
6, gate per stage, set 3 header, spec sections 10, 12. O51 set 1 step 3, spec sections 10, 12. O52 set 1 steps 6, 7, spec rule 45,
sections 10, 12. O53 set 1 step 4, spec sections 10, 12. O54 set 1 steps 3, 6, spec sections 10, 12. O55 set 1 header, steps 3, 6, spec
sections 6.3, 10, 12. O56 set 1 header, step 5, spec sections 10, 12. O57 set 1 step 3, spec sections 6.3, 10, 12.
O58 set 1 steps 4, 5, spec rule 41, sections 10, 12.
O59 status, set 1 header, step 5, spec status, sections 10, 12.
O60 set 1 steps 6, 7, set 7 step 1, spec sections 3 to 6.8, 8, 9, 10. O61 (c) set 1 step 6. O62 status, goal, set 1 steps 7 to 10, set 3 header, step 7, set 5 header, set 6 header,
set 7 header, step 6, "Merge order", spec status, sections 1, 3, 6.4, 8, 9, 10, 12, 13, Backlog. A later step number here that says "of 7" for set 1 now reads "of 10", and for set 3 "step n/7".

Acceptance rows: A1, A2, A5 to A7, A11, A31, A48, A58 set 3 step 5; A3, A4, A36, A37, A47 set 3 step 7; A57 set 6 step 2; A59 set 7 step 2; A60 set 5 step 4; A61 set 5 step 2; A62 set 3 step 2; A8, A38 set 3 step 4; A9, A10 set 3 step 2; A14, A16 set 4
step 1; A15 set 3 step 2, set 4 step 2; A17 to A22, A27, A30, A35, A39, A41 set 5 step 4; A23 to A25 set 6 step 1; A26 set 4
step 1, set 6 step 1; A28 set 4 step 4; A29 set 4 step 3; A12, A13, A32, A33 set 7 step 1; A34, A46 set 3 step 5, set 4 step 2;
A40, A51 set 7 step 3; A42, A49 set 3 step 6; A43, A55 set 7 step 2; A44, A50 set 7 step 4; A45 set 4 step 2; A52, A53 set 3
step 2; A54 set 7 step 1; A56 set 3 step 3.

## Backlog

### Later, no date, the user's choice: one real deposit and withdrawal (O61 (b), O62)

R2, R3 and R4 with real money. No set waits for them. They turn stage B's docs-only rows into MEASURED; the rows and parts are in the spec's Backlog.

### Deferred: stages C and D (O37)

Not in the numbered list, and not built in 1.4. A later track gives each its own sets and detail. The tables, R5, R6,
the parts P8, P9, P10, the call counts and the copy edits are in the spec's Backlog.

- Stage C, log and convert. Needs P8, P9, P18 (R5). Expected: new `WALK_IDS` member `log` with its fan-out
  (`walk-state.test.ts` and siblings), not-imported kind, allowlist of seen `type` values, `convert` walk or read, double-read
  rule. Size floor: 800 code lines, under 15 files. Copy edits in the same set. Reviewer: nothing parsed outside the
  allowlist; a trade never counted twice.
- Stage D, Earn orders and yield. Needs P10 (R6). Expected: `earn` walk id, flexible orders, yield per category, floor
  `now - 90 days`, own lane under the gate. Size floor: 500 code lines, under 10 files. Copy edits in the same set.
  Reviewer: what the 3-month floor drops, stated in copy.
