# 1.4-bybit: Bybit sync implementation plan, sets 1 to 11 of 11

> For agentic workers: use superpowers:subagent-driven-development. Steps use `- [ ]` tracking.

**Goal:** Bybit balances and history rows, spot trades, converts and the Funding wallet's ledger included, from a read-only key, visible and complete at each stage, with nothing that needs the user's money (O62, O64, O65). Rows and coin rows rest on the live API docs ("docs only"), with the empty mainnet shapes MEASURED. Earn is not read (O75). A coin with an open spot order is set aside (O76).

**Order of the sets:** 1, 2, 3, 4, 11, 5, 6, 9, 10, 7, 8. Sets 9, 10 and 11 keep their numbers out of order, so that the other numbers stay true in the rulings, reports and reviews (PLANNER CALLS 43, 59, 89). The total is 11 from here on: a heading or commit message of sets 1 to 4 keeps its "/10" as a record.

**Architecture:** A new `src/crypto-sync/bybit/` beside `binance/`, on the shared walk. Seams 1, 2 and 7 get
parameters first; the provider id and core follow with no way in from the UI, seams 3, 4 and 9 change with the id, and
the catalog entry goes last.

**Spec:** `docs/superpowers/specs/2026-11-03-bybit-sync-design.md`. Section numbers below are the spec's. Plan
text never overrides it; a difference found is reported.

**Status:** O62 (2026-11-04) changed the scope after the approval of O41 and O59: "I can't spend money testing what's
already covered by api documentation, so implement what you can without relying on my money". R1 and the second key ran,
and their results are written (O60). R2 to R4 with real money are off: later, no date, the user's choice (spec Backlog). Set 2 bases
on the set 1 tip, which is the commit of the O68 fix round (O63 (e); PLANNER CALL 33; was: the O66 fix round; before that 7a2391ca8; before that, after R3 and R4, O36). The
terms verdict is in spec section 9: PASS WITH CONDITIONS for global accounts. The user accepted the
5.2.2 and 6.5 doubts: keep Bybit, global
accounts only, no letter to Bybit (O42). The user answered Q1 to Q5 (spec section 13):
stages A and B ship; no notification; the two gaps are accepted; 1.4 ships before R7, with the copy of O26; and Q5 "E + A" brings spot trades
and converts into this release as set 9 (O64). The rest of the log and stage D stay under Backlog. Q6 "B: Add to 1.4" brings the Funding ledger into this release as set 10 (O65). O75 and O76 (2026-11-05): "Accept no testnet" is final, Set 1 step 9/11 ends at Part A, Q7 becomes C, clause "E2 and E4" ships, `locked` sets the coin aside, and the loan-field refusal stays. Q-b is answered: "A: Accept" (O69). A new question, Q-h, has a default and holds nothing (spec section 13). Mutation gates are paused by the user since 2026-10-25: verify and review only;
the gate text stays below for when it is lifted.

## Global constraints

- Base 57130e23c at this writing; each set's base is the tip of the set before it in the order above (set 3's base is set 2's tip after its merge into `next`, so the migration's number is fixed; set 9's base is set 6's tip, set 10's base is set 9's tip, set 7's base is set 10's tip). Every code fact is a symbol or
  anchor text: re-grep it on the actual base. Every count is a FLOOR measured at 57130e23c; the developer measures.
- Commit granularity: per step, one `kiko:qa` RED commit showing the failing output on the parent, then one
  `kiko:developer` GREEN commit. A message names `1.4-bybit set N/11 step n/m` (sets 1 to 4 keep "/10"). A re-pin names the ruling that forces
  it and lists old title to new title in the commit body. No red commit may import a module that does not exist yet.
- Tests by an agent: `npx jest <files> --maxWorkers=2` and `make jest-affected`. Never full jest, `make verify` or
  `check:all`. Exit 3 from `make jest-affected`: tell the coordinator.
- A plan-level order fact: set 5's base is set 11's tip, and set 11's base is set 4's tip (PLANNER CALL 89).
- Coordinator's queue, per set tip: `bash scripts/job-queue.sh verify <worktree> <label>`, rerun until green. Gate,
  when lifted: `scripts/job-queue.sh gate` per set, `KIKO_MUTATION_BASE` = that set's base, never a whole-branch run;
  over 30 mutable files exits 2 (`MUTATION_FILE_CAP`). Each set below stays under it, set 9 too (12 to 15 code files) and set 10 (12 to 15; was 18 to 21); `make mutable` measures.
- Set 2's tip is shippable alone. The tips of sets 3 to 6, 9 and 10 are not: they stay out of `next` until set 7 passes on device (O21,
  "Merge order"), and each still passes its queued verify. At every tip: no way in from the UI before set 7; every new
  export has a consumer at that tip, or knip fails. No held tip runs `privacy:site check`: it compares the live page, and
  it runs at publish only (O29). UI uses theme tokens only: `tone=`, `theme.iconSizes`, no colour literal (O12).
- One migration, in set 2 step 5/5, with its `kiko:reviewer` step before BATCH READY and an EXPLAIN QUERY PLAN test (O65, O68 (b), PLANNER CALLS 51, 72; was: set 10 step 1/6; before that, no migration in any set). No other set adds one. No device build of this track runs until set 2 is in `next`: the runner counts, so a phone with real data must never run an unmerged migration. No `BinanceX` rename (O7).
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
| `src/crypto-sync/bybit/bybit.log-types.ts` | the closed list of log words, each to one kind | 9 |
| `src/crypto-sync/bybit/bybit.log-history.ts` | log walk, spot legs | 9 |
| `src/crypto-sync/bybit/bybit.convert-history.ts` | convert read by index, legs | 9 |
| `src/crypto-sync/bybit/bybit.funding-match.ts` | `matchFundingLedger`, the pure rule | 10 |
| `src/crypto-sync/bybit/bybit.funding-match.repo.ts` | the stored set, `funding_match_rows` | 10 |
| `src/crypto-sync/bybit/bybit.funding-ledger.ts` | ledger walk, parsers' consumer | 10 |
| `src/crypto-sync/bybit/bybit.funding-reconcile.ts` | `reconcileFundingLedger` | 10 |
| `src/design-system/components/bybit-credentials-field/` | connect field | 7 |

## 1.4-bybit set 1/10: the terms verdict, the probe script and the user's probe run

Base: 57130e23c, plus this spec. All steps are done or closed (O75). Set 3 step 7/7 writes no code, and set 7 takes clause "E2 and E4".
Size: 1 script, 1,379 lines measured 2026-11-04, plus the host choice of step 8/11, and a floor of 160 lines for step 11/11; 1 test, plus a floor of 270 lines; no app file.
Not mutable.
Reviewer checks: the whole script for any leak path; every part against spec section 10; no write verb. "Set 1 tip" is
the commit of the O68 fix round, this text (O63 (e), PLANNER CALL 33; was: the O66 fix round; before that 7a2391ca8; before that, the commit after the second results run, O36). Set 2 bases on it.

The user's order (O23, O31, O38, O39, O41, O62, O64): part 1 of the browser step (step 1/11, done), the terms verdict (step 2/11,
done), the user's spec approval (done, O59), R1 and the second key (step 6/11, done), the empty mainnet read (step 9/11, Part A; was: and the testnet
run), and R7 on 2027-02-05 or later (O55, O60), an open check after the ship (Q4).

- [x] **step 1/11: part 1 of the browser step, DONE 2026-11-03** (O39; PLANNER CALL 18). The coordinator read both pages in the
  Orca browser at the user's word. No login was needed. The text is in `memory/refs/bybit-terms-2026-11-03/`.
- [x] **step 2/11: the terms verdict, DONE 2026-11-03** (O23, O39). PASS WITH CONDITIONS for global accounts, by a
  `kiko:reviewer`; `.superpowers/sdd/1.4-bybit/terms-verdict.md`. The stop rule did not fire. It went into spec section 9
  with `make doc-suites`. C1 to C5 and C7 are spec section 9 rows, and each step that holds one names it below. C6 is the user
  line of spec section 10.
- [x] **step 3/11: write `memory/refs/bybit-probe.sh`, DONE 2026-11-04, with fix round 4** (main checkout, untracked, like its
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
- [x] **step 4/11: fake-curl test, DONE 2026-11-04.** A fake `curl` on `PATH` feeds sentinel email, phone, address, name, id and key
  values for every part. Check: no sentinel appears on stdout or stderr, the key is in no argv, and each part stays under a
  maximum number of calls per part, with `CALL_CAP` as the hard cap (C6, O53). The script has no
  limit variable per part. The maximum per part follows from the code, with no paging loop: P1 1,
  P2 3, P3 8, P4 6, P5 1, P6 5, P7 2, P11 9, P12 16, P13 42, P14 0, P15 3, P16 9, P17 6, P18 8. The
  test pins exact counts per run and for some parts alone, and runs a `CALL_CAP` variant (O58).
  Result: `memory/refs/bybit-probe.test.sh` printed
  "4673 passed, 0 failed", exit 0 (re-run by the orchestrator on 2026-11-04 with /bin/bash 3.2.57 and jq 1.7.1-apple).
- [x] **step 5/11: read the file and hand it over, DONE 2026-11-04** (orchestrator, then
  coordinator). Was: "read the whole file. The reviewer
  passes it." The reviewer did not pass it: three reviews each gave FIX FIRST (17, 9 and 6 findings), and O56 stopped the chain after
  fix round 4 with no fourth review. O56 replaces that pass. Done under O56: the orchestrator
  read the round 4 diff and the whole final script on 2026-11-04 with no blocking defect (a read,
  not a review; O58), and the test of step 4/11 passed. The user's spec approval is given, DONE
  2026-11-04 (O41, O59). The handover was confirmed by the coordinator. Part 2 of the browser step is DONE (O60).
- [x] **step 6/11: R1 and the second key, DONE 2026-11-04** (O60): 46 and 10 calls, output lines 1 to 158 and 159 to 215 of
  `memory/refs/bybit-probe-output-2026-11-04.txt`. The second key is deleted (O61 (c)). The first key stays in the user's password
  manager until R7, on 2027-02-05 or later (O55): an open check after the ship (Q4), which holds neither set 7 nor the merge, with its
  row UNPROBED(P17) and the copy of O26. Was: this step also held R2, R3 and R4 with real money; they are under the spec's Backlog (O62).
- [x] **step 7/11: write results into the spec, first run, DONE by this commit, the fix round of O64.** R1 and the second key are MEASURED;
  docs-only rows, safe readings and clauses are written (O60, O62, O63, O64). Check: `make doc-suites`. This commit is the set 1 tip.
- [x] **step 8/11, DONE 2026-11-04 (was 8/10): the host choice in the script.** The code fact: the script holds `--testnet`. It is unused since O75. Owner: `kiko:developer`, from spec section 10, "The testnet run". Files:
  `memory/refs/bybit-probe.sh`, `memory/refs/bybit-probe.test.sh`, both in the main checkout, untracked. First argument
  `--testnet`, a closed choice of two hosts, default byte-identical; `--testnet R7` refused before the key prompt; header, key prompt, P1's host line
  and usage name the host. Check: the test pins each call's host per run and passes with `/bin/bash` and jq, as step 4/11 did. A reader
  reads the diff; O56 keeps its stopping rule. Add a pin that `--testnet R7` is refused before the prompt.
- [x] **step 11/11, DONE 2026-11-04: P8, P9 and P19 in the script (PLANNER CALLS 44, 61).** "8172 passed, 0 failed", by the orchestrator's re-run. The as-built notes are in the P9 and P19 rows of spec section 10. Owner: `kiko:developer`, on top of step 8/11, from spec section 10, the P8, P9 and P19 rows. P19 adds 1 path, a shape test for `showBusiType` and `description`, sentinels `memberId`, `afterAmt`, `descriptionEn`, `showBusiTypeEn`, the sign class of `txnAmt` per `ioDirection` as positive, negative or zero, and never the value, an equal-amount check with the sign dropped (F9), at most 3 calls, and a floor of 70 script lines and 140 test lines on top of the sizes below (was: 60 and 120). Files:
  `memory/refs/bybit-probe.sh`, `memory/refs/bybit-probe.test.sh`, main checkout, untracked. The two paths join the closed list; closed lists for `type` (the 68 words), `category`, `side`, `accountType`, `exchangeStatus`; `<other>` otherwise (O46); coin names by the shape test (O51); yes or no comparisons, no id and no amount. Sentinels `userId`, `orderLinkId`, `tradeId`, `paramValue` join the fake-curl test; P8 prints the count of spot rows with an empty `tradeId` and never a value (PLANNER CALL 64); P9 adds one read at `index` 9999, by the four forms of its spec row (PLANNER CALL 67). Size: floor 150 script lines, 250 test lines. Check: the fake-curl test passes with `/bin/bash` and jq, with exact call counts, P8 at most 3 and P9 at most 3 (was: 2). A reader reads the diff; O56 keeps its stopping rule. No set waits for this step.
- [x] **step 9/11: the user's reads, no money. ENDED at Part A, 2026-11-05 (O75).** Mainnet: `R2 P2`, `R4 P3` with `skip`, `R2 P8 P9 P19`: 11 reads, `memory/refs/bybit-probe-output-2026-11-05.txt`. Part B stopped at B1: key creation on testnet answered 10024. No other way is proposed. Was: the seven testnet steps of spec section 10.
- [x] **step 10/11: write those results. DONE by this commit: "no reading" (O75, PLANNER CALL 76).** P2 and P3 rows stay docs only, with the empty shapes MEASURED: UNIFIED `list:[{coin:[]}]`, FUND `balance:[]`, Earn `list:[]`. The clause by the row "No reading" of "What proves Earn": "E2 and E4". `locked` by O76, with spec line "`locked`" of stage A and PLANNER CALL 32 corrected: the sum is for isolated margin only. Q-b (O69), P9's maximum of 3, the as-built notes of P9 and P19, seam 2's `Source` type parameter, the 10024 row (section 4). K2 "always in step 3" falls with the run. `EARN_PRINCIPAL_WORDS` stays the page's word. Was: rows to MEASURED "on testnet". Check: `git grep -c UNPROBED` on the spec falls to P17, deferred rows under Backlog and the record rows of section 12; the named docs suites.

Gate per stage: every code set bases on the set 1 tip or later, so P1, P11, P12, P13 (edges), P15, P16 and step 2/11 hold at each of them.
No code set needs R2 to R4 (O62). P14 holds nothing: it makes no call (O49).

## 1.4-bybit set 2/10: neutral seams, Binance unchanged

Base: set 1 tip, then `next` merged in at step 5/5. Order: first code set. Size: about 270 code lines in 15 to 18 files, about 650 test lines (was 210, 9 to 12, 450: the empty table, O68 (b); before that 280, 13
to 16, 650: O30 moves seams 3, 4 and 9 to set 3). Tip: no Bybit id, no visible change; a `.kiko` file gains an empty `fundingMatchRows`. Merges alone, before any device build of this track (O21, O68 (b)). At this set,
existing suites stay green unchanged except the re-pins of step 3/5 and the suites that list tables or snapshot keys in step 5/5 (no owed state added, no 1.2-upgrade seed moves: the table starts empty); set 3
step 6/7 re-pins the status suites' calls (O30). Reviewer checks: a Binance run writes byte-identical rows, marks and text;
no behaviour moved for `binance` or `btc_wallet`; each seam's red shown on the parent; seams 3, 4 and 9 untouched; no writer of the table at this tip.

- [ ] **step 1/5: run the older-build restore (O10).** On this tip, before step 5/5 and before any id exists, a scratch test under
  `.superpowers/sdd/1.4-bybit/` (not committed to `src/`) restores a fixture file: a `bybit` account, `bybitAsset`
  holdings, `source: 'bybit'` rows, walk state, a `bybitCredentials` list, and a `fundingMatchRows` table key (O65). Check: restore passes, the account reads
  unsynced, no Keychain write for it. Output in the commit body and spec section 6.6. A failure stops the set and
  flips the decision: report it.
- [ ] **step 2/5: seam 2, `source` on the config.** `ExchangeWalkConfig` gains `source`; `PlacedWalletRow.source`,
  `placeWalletRows`; `BINANCE_WALK_CONFIG.source`. Files: `exchange/walk/walk-config.ts`, `exchange/walk/records.ts`,
  `binance/binance.walk-config.ts` and the tests that hand a config. Check: `npx jest` on those; Binance rows same.
- [ ] **step 3/5: `walk.ts` log tags to `[exchange sync]`** (5 sites). Re-pin 27 literal lines in 10 test files, one of
  them a fixture, naming O7 (O28; MEASURED 2026-11-03 at ef21601bd, `git grep -c` on the 5 tags, a floor): `walk.test.ts`
  1; `binance.history-walk.test.ts` 5; `binance.history-records.test.ts` 3; `binance.transactions.test.ts` 6;
  `binance.transactions.coins.test.ts` 1; `binance.pay-history.test.ts` 6; `binance.pay-history.untracked.test.ts` 1;
  `binance.earn-history.test.ts` 2; `binance.transfer-history.test.ts` 1; the fixture `binance.earn-test-fixtures.ts` 1.
  Grep every suite for the literal first; the developer measures again on the actual base. The call stands (PLANNER
  CALL 12).
- [ ] **step 4/5: seams 7 and 1, plus shared extraction.** `scripts/checks/plist.sh` regex gains `X-BAPI-API-KEY`;
  row in `__tests__/plist-credential-detect.test.ts`. `ensureExchangeHoldings` reads an institution list,
  `isWalletHoldingInstitution`, holding `binance` only at this tip. `runExchangeWalkPlan` and `commitExchangeSpan`
  move to `exchange/walk/`, with `binance.walk-wiring.ts` their thin caller (consumer at this tip); `createWriteSerial`
  waits for its consumer in set 3. Check: Binance's walk suites unchanged (no assertion changes; 42d49431c re-points one mock, `binance.walks.unreadable-window`); `npm run check:plist`; `npm run check:dup`.
- [ ] **step 5/5: the empty table, with what keeps every tip safe (F3, O68 (b), PLANNER CALLS 51, 72, 75).** Was: set 10 step 1/6.
  - `next` first: the coordinator merges current `next` into this branch, because `next` holds 0064 and 0065 and this base stops at 0063 (a floor; re-read both). Grep first: `snapshot-covers-every-table.test.ts`, `__tests__/closure-table.test.ts`, `run-migrations.test.ts`, `schema.test.ts`, the restore two-path suites.
  - `src/db/schema.ts`: `fundingMatchRows`, the final columns of spec section 3, stage F, primary key `(account_id, side, record_key)`, reference to `accounts`. A column added later is a second migration, so re-read rule 51 against that table now.
  - `drizzle/migrations/`: the next number at the actual base (0066 at this writing; re-read it), with `migrations.js`, meta and its own migration test. If `next` moves before this merge, regenerate: no device has run it. Never renumber after the merge.
  - The `.kiko` key: `read-snapshot.ts` appended last, because its test mock keys off the call order; `restore-snapshot.ts` with its delete, child before `accounts`, and its insert, defensive on an absent key; `data-snapshot.d.ts` optional, as `deletedImportKeys`; no `REQUIRED_TABLE_KEYS` entry, so an older build ignores it. `snapshot-covers-every-table.test.ts` requires the key, and passes.
  - Child-first delete under the FK: `src/crypto-sync/disconnect/disconnect.ts` clears the account's rows (a no-op for any other provider), and the account delete in `accounts.repo.ts` clears them before `delete(accounts)`, pinned in `accounts.repo.foreign-keys.test.ts`. Both run first on real SQLite, so a tip with this table and no such delete cannot pass.
  - No writer and no repo at this tip: `bybit.funding-match.repo.ts` waits for set 10, and no policy text changes until set 7, because the table holds nothing. Is `withWalkStateMoved`'s account merge reached by this table? The reviewer confirms that on the code.
  - Rows A88 (table part), A96. Check: `npx jest` on those; `npm run check:shipped-migrations`; `npm run check:knip`.
  - Then **a `kiko:reviewer` pass on this step alone, before BATCH READY** (every-migration-gets-a-review): name, types, final columns against rule 51, crash order, restore, older-build file, EXPLAIN QUERY PLAN.
  - Guideline 2.5.19 holds (kiko-architecture): no flag, no writer, no way in, and nothing a user or reviewer could see in either state. Cost if the track stops after this set: spec PLANNER CALL 72.

## 1.4-bybit set 3/10: provider id, client, keys and balances (stage A core)

Status: steps 1/7 to 6/7 are done on branch 1.4-bybit; step 7/7 writes no code (O75). Base: set 2 tip. Needs step 2/11 of set 1 and P1, P11, P15, P16, all MEASURED. Steps 1/7 to 6/7 need no user step: coin-row fixtures use the page samples,
and the empty read when it exists. Was: P2 and P3 with the `R4 P3` run around the redeem (O62). Size:
about 1,270 code lines in 25 to 29 files (under the cap of 30; `make mutable` measures, and a count over the cap is a
report to the orchestrator), about 2,350 test lines (was 1,200, 21 to 25, 2,050: O30 moves seams 3, 4 and 9 here; O31, O33
add rows; O29 moves the policy, its site pages and `bybit.privacy-policy.test.ts` to set 7; O39 adds A52, A53, A56; O62 adds A58, A62 and moves no count). Earn is not read, and clause "E2 and E4" is true at the tip. Tip: `bybit` in
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
  `bybit.endpoints.test.ts` (C2). Check: rows A9, A10, A15, A52 (C1: the host, and no tracked env file, plist entry or source module names `api-testnet`), A53 (C2: GET only, a closed list), A62;
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
- [x] **step 7/7: Earn, NO CODE (O75, PLANNER CALL 85).** Clause "E2 and E4": no `fetchEarnPositions`, no Earn path in `BYBIT_SIGNED_PATHS`. Rows A3, A4, A36, A37, A47 are not built. The Earn count leaves in set 4 step 5/9. O73 (c)'s "add Earn to `complete`" falls. The orchestrator closes this set's run log. Was: Earn by "What proves Earn", and a `locked` question.

## 1.4-bybit set 4/10: expiry, `.kiko`, switch gate, account detail

Base: set 3 tip. Steps 1/4 to 4/4 are done at a1097f2fb; their commits keep "of 4", and they are now steps 1/9 to 4/9. Size: steps 1 to 4 about 550 code lines in 13 to 15 files, about 1,050 test lines (was 450, 12 to 14, 900: O13, O18,
O26, O27 lines); steps 5/9 to 9/9 a floor of 200 code lines in 15 to 18 files and 450 test lines, and the developer measures. Tip: text keys exist and render only for a connected `bybit` account, which no path can create yet.
Stays out of `next` (O21). Reviewer checks: every expiry state on every surface against spec section 6.3; the switch gate
cannot strand a Binance user; translator review of this set's keys; each row of the `locked` matrix and each "An account with every coin set aside" row in spec section 3; no text offers a way around 10024. The review of `git diff 9d862c080 <tip>` covers steps 1/9 to 9/9, after step 9/9.

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

Steps 5/9 to 9/9 (O75, O76). Each step is for one fresh `kiko:developer`, in this order. Commit granularity: one commit per step, or a red commit and a green commit when the step's red is shown that way, with a message `1.4-bybit set 4/10 step n/9: ...`. A re-pin lists old title to new title and names the ruling. Texts come from `.superpowers/sdd/1.4-bybit/texts-for-review-o76.md` after the coordinator returns the user's review; if the review is not back, use the DRAFT words, and the coordinator holds set 4's READY FOR VERIFY for it. Re-grep every symbol here on the actual base. Battery mode: named jest with `--maxWorkers=2` after `bash scripts/wait-load.sh 15`; `make jest-affected` and the check scripts wait for CHARGER BACK (HANDOFF step 5). Counts are floors.

- [x] **step 5/9: the Earn count leaves (O75, PLANNER CALL 85).** Grep first: `git grep -n "bybitEarnLeftOut\|earnLeftOut"` over `src`, `.claude/skills`, `harness`, `src/help` (help topics hold none at this writing). In this one step (harness-workflow "Removing or renaming a catalogue key"):
  - `exchange/walk-state/exchange-state-patch.ts`: `WalletNotes`, `notesOfWallet`. `exchange/walk-state/walk-state.ts`: `ParsedWalletNotes`, the stored notes type, `walletNotesOf`. `exchange/history-status/history-status.ts`: `BalanceNotes`, `NO_NOTES`, `notesOfParsed`, the comment. `crypto-sync-section.component.tsx`: `BalanceNotesLines` and its comment. `en.ts`, `uk.ts`: the four plural keys, and the comment above them if it holds only for them. `en.casing-by-role.test.ts`: the `BYBIT_PHRASES` comment, and `'Bybit Earn'` only if no text still needs it.
  - Tests: `exchange-state-patch.balance-notes.test.ts`, `walk-state.balance-notes.test.ts`, `history-status.test.ts`, `bybit.provider.state.test.ts`, `crypto-sync-section.component.bybit.test.tsx`: drop the count rows and the plural rows; rewrite each seed that names `earnLeftOut`.
  - `bybitKinds`, the footer, the policy and connect stay for set 7.
  - Check: `npx jest` on those files and `src/i18n/locales/`; tsc through the commit hook; `git grep earnLeftOut -- src` prints nothing except the A116 seed of step 7/9, which reads it as an unknown key.
- [x] **step 6/9: code 10024 (O75, PLANNER CALL 83, spec section 4).** `bybit.client.ts`: `BybitRefusalClass` gains `compliance`, `failureOfCode` a row, the named union in `errorOf` the class, so it never turns into `expired`. `bybit.failure-text.ts`: its text. `en.ts`, `uk.ts`: `bybitComplianceRefused`. Red first: `bybit.client.test.ts` shows `unknown` for 10024 on the parent (the row in the code table and the row "after the stored date"). Rows A119. No text, comment or test states any way around the block: the text states the fact only. Check: `npx jest` on `bybit.client.test.ts`, `bybit.client.reads.test.ts`, `bybit.failure-text.test.ts`, `bybit.shipped-copy.test.ts`, `src/i18n/locales/`.
- [x] **step 7/9: `locked` sets the coin aside (O76, PLANNER CALLS 77 to 80, spec section 3).** Every place the `borrowed` path needs:
  - `bybit.client.ts`: `BybitUnifiedCoin` gains `locked: unknown`; `unifiedCoinOf` carries it. `BybitFundCoin` and `fundCoinOf` stay. `bybit.balance-test-fixtures.ts`: `unifiedCoin` defaults `locked: '0'`, and `unifiedResult` passes the field on, in place of its fixed `locked: '0'`. `bybit.client.reads.test.ts`: its exact rows gain `locked`.
  - `bybit.balance-read.ts`: `WalletRead.openOrder`; `CoinOutcome` kind `openOrder`; a test on the row by the same `isPositive` and `plainAmountOf`; `outcomeOf` in the order of PLANNER CALL 78; `readOf` takes the row's test as a parameter, and `fundReadOf` passes one that never sets aside. An untracked coin still `continue`s before any of it. Its comments.
  - `bybit.provider.ts`: the filter in `appendWallet` and its comment; `statePatchesOf`: `unified` gains `openOrder`. FUND has none.
  - `exchange-state-patch.ts`: `WalletNotes`, `notesOfWallet` gain an optional sorted `openOrder`, written only when not empty. `withBalanceNotes` does not change: it is the clear.
  - `walk-state.ts`: `ParsedWalletNotes`, the stored notes type, `walletNotesOf`. `history-status.ts`: `BalanceNotes`, `NO_NOTES`, `notesOfParsed` (once, sorted, as `borrowed`).
  - `crypto-sync-section.component.tsx`: `BalanceNotesLines`, one caption per coin, tone as `bybitCoinBorrowed`. `en.ts`, `uk.ts`: `bybitCoinOpenOrder`, and the changed `bybitCoinBorrowed`, with the exact-text pins re-pinned naming O76. `bybit.shipped-copy.test.ts`: the new line holds "A balance shown here is from an earlier sync", and says neither "last balance" nor an amount.
  - Rows A108 to A116. A111 uses the docs' sample bytes: `"walletBalance": "0"`, `"borrowAmount": "0.0"`, `"spotBorrow": "0"`, `"locked": "0"`, coin `BTC`. A114 pins the clear on the first good read, and A116 pins the older build. In A116 use a stored `earnLeftOut` as one of the unknown keys.
  - Check: `npx jest` on `src/crypto-sync/bybit/`, `src/crypto-sync/exchange/walk-state/`, `src/crypto-sync/exchange/history-status/`, `crypto-sync-section.component.bybit.test.tsx`, `src/i18n/locales/`. Existing suites: no owed state is added, and no 1.2-upgrade seed moves, since `balanceNotes` is not walk state. A Binance run writes byte-identical state (`binance.provider` suites green unchanged).
- [x] **step 8/9: a refused coin has its own note and text (PLANNER CALL 81).** `bybit.provider.ts`: `statePatchesOf` stops writing kind `oversizedBalance`, and `unified` and `fund` gain `refusedCoins`. `exchange-state-patch.ts`, `walk-state.ts`, `history-status.ts`: as for `openOrder` in step 7/9. `crypto-sync-section.component.tsx`: `BalanceNotesLines` shows `bybitCoinRefused`. `CoinLines` and `accountDetail.oversizedAmount` stay for Binance and a history row. `en.ts`, `uk.ts`: the key. `bybit.provider.test.ts`, `bybit.provider.state.test.ts`: re-pin the rows that name `oversizedBalance` for Bybit, naming O76, and keep the rows of the "complete" behaviour as wallet-by-wallet rows of the notes. Rows A117. `logRefusal` stays. A read of the Binance paths: `binance.provider` and `exchange-state-patch.oversized-balance.test.ts` stay green unchanged. Check: `npx jest` on those files and the section suites.
- [x] **step 9/9: the account does not look empty (O76's condition, PLANNER CALL 82).** A new small component in `src/screens/account-detail/`, by kiko-code-style's folder rules, with its own `useLiveQuery(syncStateRepo.getQuery(account.id), ['sync_state'])`, gated on its `isLoading`: `hasKeyLines(provider)` and any list of `balanceNotesOf` not empty gives `EmptyState` with `bybitBalancesNotRead`; any other case gives today's `emptyHoldings` block, byte-identical. `account-detail.screen.tsx`: it replaces the `EmptyState` under `!hasActiveHoldings`. Keep the action and `testID` of the block. Red on the parent: a Bybit account with a stored refused coin and no holding shows "No holdings yet". Rows A118. Check: `npx jest` on the account detail suites; `check:component-i18n-namespace` when CHARGER BACK allows, and read kiko-translator's namespace rule first, because a key under `accountDetail` read by a new component can break it; `check:screen-imports` the same. A device confirm of this block is owed with set 4's account detail confirm (HANDOFF, "Owed later").

Fix rounds A, B and C of set 4 (O80, O81, O83), DONE: 31fc41a16 (A), 42bbbfd0d (B), 039d2af25 (C). Fixed: F1 to F5, F7, F8, F10 to F12, the cooling rule and the ponytail cuts. F6, F9 and the re-review finding 6 are in the Backlog.

## 1.4-bybit set 11/11: the past line while a balance is old (runs after set 4, before set 5; O78, O83)

Base: set 4 tip, after the developer of O84. The design and its numbers: spec section 3, "The past line while a balance is old", PLANNER CALLS 86 to 89. Each step is for one fresh developer, in this order. Red first on the parent, per the Global constraints, and step 1/5 has no red. A message names `1.4-bybit set 11/11 step n/5: ...`. Re-grep every symbol on the actual base. Battery mode: named jest with `--maxWorkers=2` after `bash scripts/wait-load.sh 15`; `make jest-affected` and the check scripts wait for CHARGER BACK. Counts are floors, and the developer measures.

Size (floors): about 45 code lines in 8 to 10 files, about 350 test lines in 6 files. No migration, no new text at this tip, no catalogue key, no flag: `datesBalance` decides a date, not what a user can see (2.5.19). Stays out of `next` (O21). Is any seed a 1.2-upgrade world with owed state from this set? No: no owed state is added, and no seed there holds a `bybitAsset` key (the developer checks `git grep -l bybitAsset -- src/statistics src/test-support`). "Existing suites green unchanged" holds, except the one re-pin of step 5/5. Reviewer's top question: can any holding that is not Bybit's change one value? Also: spec rows 1 to 14 against the code; the last point against Home; no guessed opening (O62); that no reader other than the valuer reads `balanceReadAt`. Gate, when lifted: `KIKO_MUTATION_BASE` = the set 4 tip. The coordinator queues the verify once, at this set's tip.

- [ ] **step 1/5: the Binance regression test (`kiko:qa`, one commit, no red).** `src/statistics/holding-value-at/holding-value-at.test.ts`, row A121, beside the existing `describe`, with no import of Bybit code. It pins today's values, so it passes on today's code unchanged, and it must stay green through this set: 1. "a Binance holding counts every row against its balance, with a row after its stamp": metadata `{ binanceAsset, syncedAt: T }`, balance 1, one row of -0.2 a day after T; 1.2 the day before, 1 from its day. 2. "a Binance holding at zero with no stamp opens below zero by its earlier buy": balance 0, a row of +1; -1, then 0. 3. "a holding of any other source counts every row, whatever its metadata": `monobankId`, `walletAddress`, none, each with a stamp and a row after it, against `referenceHoldingValueAt`. Row 1 and row 2 pin the fault of the Binance finding on purpose: a later fix of Binance re-pins them, naming its ruling. The commit body shows the green run on the parent. Check: `npx jest src/statistics/holding-value-at/holding-value-at.test.ts --maxWorkers=2`.
- [ ] **step 2/5: the mark.** `src/holdings/holding-metadata/holding-metadata.ts`: `BALANCE_READ_AT_FIELD`, not in `carriedMetadataKeys` and not in `strippedOnDisconnect`, with a comment that says why. `src/crypto-sync/provider/provider.ts`: `BalanceProvider` gains optional `datesBalance`. `src/crypto-sync/sync/sync.ts`: the upsert's `metadata` gains the field, with the value of `syncedAt`, only for such a provider. `bybit.provider.ts`: `datesBalance: true`. Row A122. Binance's metadata stays exactly `{ syncedAt }`: `sync.test.ts` and the `binance.provider` suites stay green unchanged. Check: `npx jest` on `sync.test.ts`, `src/crypto-sync/provider/`, `src/crypto-sync/bybit/bybit.provider`, `src/holdings/holding-metadata/`.
- [ ] **step 3/5: the valuer. WAITS FOR Q-i (spec section 13); this text is option A, the recommendation.** `holding-metadata.ts`: `balanceReadAtOf`, on the pattern of `syncedAtOf`, and `isBybitHolding` if no such reader exists there (`bybitKeyOf` lives under `crypto-sync` and must not come into `statistics`). `holding-value-at.ts`: `SeriesTransaction` gains optional `source`; before the `sumByDay` loop, and only for a holding with a `bybitAsset` key, the filter of PLANNER CALL 87, so the body below it does not change and any other holding reads no row one more time; update the doc comment. `statistics.screen.tsx`: `groupByHolding` takes and passes `source`. New `holding-value-at.bybit.test.ts`; `statistics.screen.test.tsx`; `net-worth-series.test.ts`. Rows A123, A124. If Q-i is B: rows after the date also count from the day after the date; a holding with no date stays off the line; row 1 reads 1, 0.8; row 8 reads 1, 0.8; A124's last-point row becomes the exception, and kiko-domain's invariant names it. If Q-i is C: the valuer needs the state's notes, so stop and report to the planner. Check: `npx jest` on `src/statistics/`, `statistics.screen.test.tsx`, `holdings.repo.test.ts`.
- [ ] **step 4/5: the whole path on real SQLite.** New `src/crypto-sync/bybit/bybit.past-line.set-aside.real-sqlite.test.ts`: real `runBalanceSync` with `bybitProvider` and a fake fetch, rows through `addManyDedup` with `source: 'bybit'` (no walk exists at this tip), values through `buildNetWorthSeries`: spec rows 2, 3, 8, 10, 11, 13 by number. `disconnect.real-sqlite.test.ts`: A125's row. Any missing production code here is a report, not a change in this step. Check: `npx jest` on those two files. Named for set 5, 6, 9, 10: a past-line seed that writes a Bybit holding by hand gives it `balanceReadAt` at or after its rows, per pin, never in a shared helper; A77 and A89 to A95 read this line.
- [ ] **step 5/5: the block reads the balance list (O83 finding 2, PLANNER CALL 88).** `history-status.ts`: `untrackedBalanceCoinsOf(state, isTracked)`, reading `untrackedCoins.balance`, beside `untrackedCoinsOf`; `history-status/index.ts`. `holdings-empty-state.component.tsx`: it replaces `untrackedCoinsOf`, and its top comment says so. `crypto-sync-section` keeps the union. Red on the parent: an account with no holding, and PEPE on the history list only, shows "Some balances not read". Re-pin, naming O83: in `account-detail.screen.test.tsx`, the row `a coin on the history list` of "shows the not-read block, never No holdings yet, for an account that holds only %s Bybit does not track" leaves that table and becomes the new title "shows No holdings yet for an account whose untracked coin is on the history list alone", with the caption still naming the coin. List old title to new title in the commit body. Rows A126, with the spec's matrix and its "was". Check: `npx jest` on `src/crypto-sync/exchange/history-status/`, `src/screens/account-detail/account-detail.screen.test.tsx`, `src/screens/account-detail/holdings-empty-state/`, and `check:component-i18n-namespace` when CHARGER BACK allows.

After step 5/5: a `kiko:reviewer` pass on `git diff <set 4 tip> <tip>`; then retrospect and scribe: kiko-domain's valuer paragraph and "Statistics series performance", kiko-exchange-sync's Bybit section and its line "writes a FRESH `{ syncedAt }` metadata object". If the user takes the DRAFT of Q-i's second part, it lands with `statistics.bybitPastLimits` in set 7 step 3/6, and A83 grows; L1S's count changes with it.

## 1.4-bybit set 5/11: cursor reader, budget and capital walk (stage B)

Base: set 11 tip (PLANNER CALL 89; was: set 4 tip). Needs the live pages of spec section 3, and P11, P12, P13 (edges), MEASURED. Was: P4, P5, P6 with real money (O62). Size: about 1,060 code lines in 7 to 9 files, about 2,060 test lines, split (was 1,050, same, 2,040: the stop signal for the mark, PLANNER CALL 73; before that 1,030, same, 1,980: `minSplitMs` and A98, PLANNER CALL 63; before that 1,000, same, 1,900: the series-tagged range of PLANNER CALL 37, A35, A60, A82). Fixtures take the page samples. Tip: the run arm reads deposits and withdrawals; still no
way in. Stays out of `next` (O21). A coin with an open order or a loan is on UNIFIED and every row of this walk is on FUND, so those two do not reach this set. A refused FUND coin and a FUND wallet not read do reach it, and set 11 has already covered them: spec section 3, "Which readers". This walk also starts the history list of untracked coins, which set 11 step 5/5 keeps out of the not-read block. Reviewer checks: each early return of spec section 5; settled matrix; no stored cursor; no text that calls a waiting row harmless (O63 (d));
`withdrawType=2`; O6 sentinel; the floor stays 729 days (R1); rules 45 and 47, and each safe reading of spec section 3 against the page.

- [ ] **step 1/4: budget and config.** `bybit.history-budget.ts` (`BybitLane`, caps 30 and 20 here, set 9 adds its two, interval 1100,
  `createBybitHistoryRun`, refused call counted), `bybit.walk-config.ts` (`source: 'bybit'`, `bybitAsset`). P16 and
  P12 are MEASURED, and the interval and caps stay (spec section 5).
- [ ] **step 2/4: `readCursorSpan`** (`bybit.cursor-span.ts`), at the `walkSpans` `read` seam: follows
  `nextPageCursor`, `canAfford` per page, `undefined` before a span's first page, `split` over `minSplitMs`, `undefined` at `minSplitMs` or less, with a signal to its caller when that span was the pass's first read (F4, PLANNER CALL 73; capital and transfer ignore it) (a day for capital and transfer, here; 1 second for `log` and `fundingLedger`, from their sets; was: 1 minute, O68 (a); before that a day for all, PLANNER CALL 63; spec section 5, "The pager rule"); a repeat cursor, or a row outside the span
  by both readings of its window field, is `bybit-page-drift` (rule 22, PLANNER CALL 29); an empty or absent cursor, or a page with no row, ends the span; a pending row with no time is never drift, and the time sort leaves it out (rule 19,
  rule 47). No `readIdCursor` or `readSeriesSpan` stretch (O8). Rows A20, A61, A98, Q5 start.
- [ ] **step 3/4: parsers.** `bybit.history-client.ts`: tracked rule, unreadable, untracked counted never parsed, named
  fields only (the list of each series in spec section 3: `result.rows`, and `result.list` for transfer), `BybitHistoryParseError`, time by digit count: 13 ms, 10 the whole second, any other unreadable (A60); an empty, 0 or absent time reads the same (rule 47). A withdrawal's shown `time` is `createTime` (A82). Paths added to `BYBIT_SIGNED_PATHS`.
- [ ] **step 4/4: the capital walk.** `bybit.capital-history.ts`: series `deposit`, `internal`,
  `withdraw`; windows 29 days; floor `now - 729 days`, which P12 did not move (R1); `reach` per rule 18;
  a withdrawal's `extentOf` is `createTime` alone (PLANNER CALL 29); `depositType` 0 only (PLANNER CALL 30); removal of 70011; forward owes constant per the
  Transfer rule, holding each code of a waiting status with a time. Every row on FUND, clause W1 (rule 45). The walker stays as it is: a deposit with
  no time and no final status, and a row with an unreadable time, makes no row, and this file tags the range `settleRecords` owes with the series, so `isOwedPast` lets the forward pass go on (rule 47, PLANNER CALL 37, O63 (b); was: owes nothing, CALL 28). The stop codes of these rows join the forward owes list. A 70011 row with no time still removes by key (rule 14). Guard on an empty plan
  tests all four lists. Arm: `capital` in `logOnFailure`, `captionWalksOf('bybit')` gains `capital`. Rows A17
  to A22, A27, A30, A35, A39, A41, A60, A82. A failing proof of a safe reading is a report to the planner, never a loosened row.

## 1.4-bybit set 6/11: transfer walk and convergence proof (stage B)

Was: "before this set, a planner designs the fix of the past line". That design is set 11, and it runs before set 5 (O78, O83, PLANNER CALL 89).

Base: set 5 tip. Needs the live pages and the transfer path (MEASURED). Was: P7, P13 with rows (O62). Size: about 500 code lines in 5 to 6 files, about 1,300 test lines (was 1,200: A57).
Stays out of `next` (O21). Reviewer checks: pair id has one coin; wallet words closed; section 5 tables replaced with
measured numbers. Empty pages (MEASURED 2026-11-05): the log and Earn omit `nextPageCursor`, and the Funding ledger sends it empty, so a walk treats both as the end; no page with rows was read, and a fixture of a real page is built from the docs and marked so. No line here claims a live proof.

- [ ] **step 1/3: `bybit.transfer-history.ts`**, 7-day windows, both legs, pair id from `bybit.holding-keys.ts`, unknown
  wallet owed, with its cost stated in spec rule 42 (F9). One series named `transfer`, so an unreadable time owes a tagged range (PLANNER CALL 37). Arm and `captionWalksOf('bybit')` gain `transfer`. Rows A23 to A25, A26, A120: this is the first walk that can create a Unified holding at zero for a coin set aside (`walk.ts`, `balanceMinorUnits: 0`).
- [ ] **step 2/3: `bybit.keys.property.test.ts`, `bybit.convergence.test.ts`**, Q1 to Q7, run through real
  `planWalkPasses` and `runWalkPlan` with a fake route that serves the seeds, cut at every commit for the restart property,
  and added to `__tests__/property-sweep-sites.test.ts`. A red for Q3 shown by a mutant that drops a mark. A57: the fake route serves each window field in turn.
- [ ] **step 3/3: measured numbers.** Scribe writes the convergence table's MEASURED column into spec section 5. A cap that
  fails a seed's bound is a report to the orchestrator, never a loosened bound.

## 1.4-bybit set 9/11: spot trades and converts (stage E; runs before set 7, PLANNER CALL 43)

Base: set 6 tip. Needs the live pages of spec section 3, stage E; no user step. Set 1 step 10/11 holds no P8 or P9 row (O75): only the empty shapes are MEASURED, so stage E stays docs only. A partial fill during an open order is the row set 11 keeps from moving the past line until the first good read: spec section 3, "Which readers". Was: stage C in the Backlog, needing R5 with real money (O37). Size: about 990 code lines in 12 to 15 files, about 2,240 test lines, split, each new test file under 1000 lines (a floor; was 950, same, 2,170: the mark and its line, A106, F4; before that 850, same, 1,800: `plainHintOf`, N2 to N6, A99, A100, A102 to A104; before that "floor 800, under 15 files"). Under `MUTATION_FILE_CAP`; `make mutable` measures. Tip: the run arm reads the log and the converts; still no way in. Stays out of `next` (O21). No migration: `log`, `pageIndex`, `passOwed`, `logKinds` and `denseSpans` live in `exchange_state`.
Reviewer checks: every field against the live page; nothing parsed outside the closed list; a trade never counted twice, under one row per fill, one row per order, and a convert in both lists, except the two double counts that spec "What stays wrong" names; each rule of the spending table in spec section 3; a Binance run writes byte-identical rows, marks and state text; `userId`, `orderLinkId`, `extInfo` and the value of `tradeId` reach nothing; a failed spot shape owes no point; the policy's statement of which ids are stored still holds.

- [ ] **step 1/5: shared seams, Binance byte-identical.** `exchange/walk-state/walk-state.ts`: `WALK_IDS` gains `log`; `WalkMarks.pageIndex` and `WalkMarks.passOwed`, both optional, so a Binance state keeps its text (PLANNER CALL 66); new patch kind `logKinds`, reader `logKindsOf`, in `exchange-state-patch.ts` and `history-status.ts`, on the `untrackedCoins` precedent; new patch kind `denseSpans`, reader `denseSpansOf`, at most 2 entries (F4, PLANNER CALL 73). `exchange/amounts/amounts.ts`: `AmountUse` `rounded-row`, and `rowMinorUnits` accepts it. `bybit.history-budget.ts`: lanes `log` 20, `convert` 10. `CAPTION_WALKS` for Binance stays its 8 through `captionWalksOf`. Red first on the parent, in existing suites, so no red imports a missing module. Grep the fan-out first: every literal that lists every walk (`walk-state.test.ts`, `walk-state.multi-coin.test.ts`, `src/test-support/walk-marks.ts`, `src/test-support/walk-disturbances.ts`, a floor), and re-pin those naming O64. Is a 1.2-upgrade seed moved? A new empty walk adds no owed state, so each seed gets one `log` entry with no owed ground, and no suite's result moves; the developer checks that against `walk.owed-since.test.ts`. Rows A79, A81. Check: `make jest-affected`; exit 3 goes to the coordinator; tsc.
- [ ] **step 2/5: the closed list and the parsers.** `bybit.log-types.ts`: the 68 words re-read from the live enum page, each to one kind, `kindOfLogRow(type, category)`. `bybit.endpoints.ts`, with its literals in `bybit.endpoints.test.ts` (C2, A53): `/v5/account/transaction-log`, `/v5/asset/exchange/query-convert-history`. `bybit.history-client.ts`: `fetchLogPage` with `accountType=UNIFIED`, no `category`, no `type`; a body with no `result.list` is a failure; for a spot `TRADE` only the fields of spec section 3, and of `tradeId` only whether it is empty (PLANNER CALL 64). `fetchConvertPage` by `index`, `limit=100`. A row that does not parse is unreadable, never a throw that fails the page. Rows A63, A80 (parser part). Check: `npx jest` on those; the page samples as fixtures, and a spot row built on the page's field words, marked as built.
- [ ] **step 3/5: the log walk.** `bybit.log-history.ts`: `planWalkPasses`, `runWalkPlan`, `readCursorSpan` with `minSplitMs` 1 second (O68 (a)), and `plainHintOf` new in `bybit.cursor-span.ts`, with this walk as its first caller so no tip holds an unused export, testing for a forward or re-scan pass by name; the shared `runWalkPlan` does not move, and a Binance run stays byte-identical (PLANNER CALL 63); the signal writes the `denseSpans` entry, only when it changes, and the commit past the span drops it (PLANNER CALL 73); one series `log`, windows 7 days, floor `now - 729 days`, `reach` per rule 18. A spot row's check `change + fee = qty` by `addDecimal` and `compareDecimal`; a failed check, a third coin or an empty `tradeId` owes the span as one range tagged `log`, never a point (PLANNER CALLS 64, 65); amount by `rowMinorUnits(coin, change, 'rounded-row')`, and a leg that rounds to 0 writes no row and leaves the other leg (N6); key and pair of spec section 3 (PLANNER CALLS 38, 40); one key with two values owes both; the other coin from `symbol`; `counterpartWallet` or `untrackedCounterpart`; `operation: 'trade'`; `description: ''`; every row on `<COIN>:unified`, through `placeWalletRows`. Any other kind writes no row, and its kind goes to `logKinds`, before the marks move. Guard on an empty plan tests all four lists. Arm: `log` in `logOnFailure`, after transfer; `captionWalksOf('bybit')` gains `log`. Rows A64 to A71, A76 (log half), A98 (log), A99, A100, A104 (log half), A106 (walk part), Q8. Check: `npx jest` on those, real SQLite for A68, and `make jest-affected`.
- [ ] **step 4/5: the convert read.** `bybit.convert-history.ts`: index paging by the rules of spec section 3, "The walks", `pageIndex`, `passOwed` and the bound of 12 points (PLANNER CALL 66), rows before marks; an empty page, a repeated page, a refusal of class "any other" at `index` over 1 and `CONVERT_PASS_PAGES` each end the pass and move the cursor (PLANNER CALL 67; was: a repeated page moved no mark); the wallet word, status and refusal rules; legs as in Binance's `settledOutcomeOf`, not imported from it, with `operation: 'convert'` and the pair id that names both coins; a row older than the floor makes no row (PLANNER CALL 49). Arm: `convert` after `log`; `captionWalksOf('bybit')` gains `convert`. Rows A72 to A75, A76, A80, A102, A103, A104 (convert half). Check: a disconnect drops `pageIndex` and `passOwed` (A26 grows); `npx jest` on those.
- [ ] **step 5/5: the line, the proof and the numbers.** `bybitLogLeftOut` with `bybitLogKind.*` beside `CoinLines` in `crypto-sync-section`, and `bybitHistoryDense` in place of `exchangeHistoryPending` while a `denseSpans` entry stands (a Binance caption stays byte-identical; A106, line part), en and uk, keeping the section's complexity budget. `bybit.past-line.real-sqlite.test.ts` runs the worked example through `buildNetWorthSeries` with the fake routes (A77). `bybit.convergence.test.ts` gains the log and convert seeds, cut at every commit (Q9), and joins `__tests__/property-sweep-sites.test.ts` with Q8. Scribe writes the MEASURED column of the stage E tables into spec section 5. A cap that fails a seed's bound is a report to the orchestrator, never a loosened bound. A failing proof of a safe reading is a report to the planner, never a loosened row. Check: `make jest-affected`; translator review owed at set 7.

## 1.4-bybit set 10/11: the Funding ledger (stage F, O65; runs before set 7, PLANNER CALL 59)

Base: set 9 tip. Needs the live pages of spec section 3, stage F; no user step. Set 1 step 10/11 holds no P19 row (O75): only the empty shapes are MEASURED, so stage F stays docs only, and `EARN_PRINCIPAL_WORDS` stays the page's word. Was: under Backlog (PLANNER CALL 46). Rests on the O66 fix round for `readCursorSpan`'s split (N1) and the convert `cursor` (N4, N5, PLANNER CALL 68). Size: about 935 code lines in 12 to 15 files, about 2,855 test lines (was 910, 18 to 21, 2,730; the table moves out, about 60 code lines, 6 files and 200 test lines, to set 2; repair, the difference write, the prune and F9 to F11 add about 85 code lines and 325 test lines, M29 to M35, A105, A107), split, each new test file under 1000 lines (a floor). Under `MUTATION_FILE_CAP`; `make mutable` measures. Tip: the run arm reads the ledger; still no way in. Stays out of `next` (O21).
Existing suites: is any seed a 1.2-upgrade world with owed state from this set? The table comes from set 2, empty, and a Binance account writes no `fundingLedger` entry, so no; each suite that lists walks re-pins by name, and the developer checks `walk.owed-since.test.ts`.
Reviewer checks: rule 51 against each row of the matrix; a wrong match reads as a lost row, except M16, M23, M32, M35 and the row "on no list", each named; `waiting` removes nothing; no schema edit in this set; no server text stored or shown; a listed row out of spending and each matcher; `memberId`, `afterAmt`, `descriptionEn`, `showBusiTypeEn` reach nothing; a Binance run writes byte-identical rows, marks and state text; each row of spec "What stays wrong" and clause L1 against the shipped behaviour.

- [ ] **step 1/6: the store (PLANNER CALL 51; was: the table too, now set 2 step 5/5, PLANNER CALL 72).** `bybit.funding-match.repo.ts`, on the table set 2 made: read by account, upsert by key, delete by key, the prune. No schema edit and no migration: a column this set finds it needs is a report to the orchestrator, because a second migration reopens F3. Rows A88 (store part). Check: `npx jest` on those, real SQLite.
- [ ] **step 2/6: the pure rule, matrix first.** `bybit.funding-match.ts`, words in `bybit.funding-words.ts`, red from the matrix in spec section 3: `matchFundingLedger`, W, H and `now` as arguments with the constants beside them; candidates by a lookup on `normalizeDecimal` text, nearest first, then repair with an explicit stack (F1, F8, PLANNER CALL 70); the convert's gate and owed ground of step 4 only under W old (PLANNER CALL 68, F10), `compareDecimal` and `addDecimal` only, no `Number` on an amount. A row's `earn_principal` reads as stored (C1). Rows A84, Q12. Check: `npx jest` on those; a grep shows no `parseFloat` or `Number(` on an amount in the file.
- [ ] **step 3/6: sources write their records.** In `bybit.capital-history.ts`, `bybit.transfer-history.ts`, `bybit.convert-history.ts`: the record, with the columns of spec section 3, in the same `add`, before marks, and in `remove`; each series' parser gains `depositFee`, `withdrawFee`, `tax`, and only for this. A source of a wallet word that is not FUND writes none. Rows A87 (source part). Check: each walk's suites stay green with a store double; `make jest-affected`; exit 3 goes to the coordinator.
- [ ] **step 4/6: the ledger walk.** `exchange/walk-state/walk-state.ts`: `WALK_IDS` gains `fundingLedger`, patch kinds `fundingHeld` and `fundingLeftOut`, on the `logKinds` precedent, red first in existing suites. Grep the fan-out as set 9 step 1/5 did, and re-pin naming O65. `bybit.endpoints.ts`, `bybit.endpoints.test.ts` (C2, A53): the path. `bybit.history-budget.ts`: lane `fundingLedger` 20. `bybit.history-client.ts`: `fetchFundingLedgerPage`, named fields only. `bybit.funding-ledger.ts`: `planWalkPasses`, `runWalkPlan`, `readCursorSpan`, the split to a second with `plainHintOf`, a span rounded out to whole seconds, and the `denseSpans` entry (O68 (a), PLANNER CALL 73), and the repeated-cursor end of spec section 3, bad rows and a negative or zero `txnAmt` owe one tagged range (F9), no `currcCursor` marks the flag, and the parse sets `earn_principal` and stores no word (C1, PLANNER CALL 75). Guard on an empty plan tests all four lists. Arm: after `convert`; `captionWalksOf('bybit')` gains `fundingLedger`. Rows A79 (grows), A85, A86. Check: `npx jest` on those; a Binance state text is byte-identical.
- [ ] **step 5/6: reconcile.** `bybit.funding-reconcile.ts` in its own `logOnFailure`, last: rule 51 on the stored set, then only the difference against the stored keys: `placeWalletRows` and `addManyDedup` for `listed` with no row, `removeSyncedRows` for `explained`, `held` or `earnMove`, never for `waiting` and never for a key with no stored ledger row (F2, F8, PLANNER CALL 71); the counts only when they change; the prune at the floor minus 2 W. Rows A87, A88, A101, A107, Q10, Q11, Q13; join `__tests__/property-sweep-sites.test.ts`. Measure `matchFundingLedger` on the three seeds of spec section 5, on Node, against the pass numbers and the factor there, then one reconcile with 100,000 stored rows on real SQLite, and write each number in the commit body; a result over a pass number is a report to the orchestrator. Check: real SQLite suites, cut at every commit; a second reconcile writes nothing.
- [ ] **step 6/6: marker, label, lines and the past-line proof.** `untracked-counterpart.ts`: kind `ledger`, code `ledger:funding`; `row-description.ts`: the fixed label; `bybitFundingHeld`, `bybitFundingNoId` beside `CoinLines`, en and uk, keeping the section's complexity budget. `bybit.past-line.funding.real-sqlite.test.ts`: the kind of proof the user named: A89 (M16, M23 double by number), A90, A91 (the worked example with the ledger on), A92, A93, A94, A95, A105 (M29, M31, M32 by number). Scribe writes the MEASURED column of the stage F table into spec section 5. A cap that fails a seed's bound is a report to the orchestrator, never a loosened bound. A failing proof of a safe reading is a report to the planner, never a loosened row. Check: `make jest-affected`; translator review owed at set 7.

## 1.4-bybit set 7/11: the way in, shipped stages A, B, E and F (catalog last, O9)

Base: set 10 tip (was: set 9 tip; before that, set 6 tip). Needs P1, P11 and the URL of part 2, all done. The Earn clause is "E2 and E4" (O75). Size:
about 570 code lines in 18 to 22 files, about 1,170 test lines (was 1,160: A44 and A83 grow, C1, F6, F7; before that 540, same, 1,080: the ledger read at connect, clause F3, A97; before that 480, 17 to 21, 1,000: the Statistics line and A78, the log and convert reads at connect, clauses F2 and L1; was before that 450, 16 to 20, 950: PLANNER CALLS 25 and 27; O29 moves `bybit.privacy-policy.test.ts`
here; O39 adds A51, A54, A55), plus the policy and site pages (O29). Tip: Bybit visible and complete. Merge: the batch of
"Merge order", only after the device check on this branch (PLANNER CALL 15). That check, step 6/6, is "fundamentals done" (O44).
Reviewer checks: compliance section whole, each
surface's copy against spec section 8, help pins, the policy text against spec section 9; C4's wording (no Bybit look, no line
that offers Kiko in place of the Bybit app) and C3 (no price, ad, IAP, tip or sponsor), both by judgment; kiko:translator on
every new key.

- [ ] **step 1/6: credentials field.** Extract `ExchangeKeyForm` from `binance-credentials-field`, Binance's suite unchanged;
  new `bybit-credentials-field` over it, verifying through `fetchKeyInfo` and one real read of each shipped route, 10 calls (F8, O64, O65, O75; was: 11 with one Earn category, 12 with both); `bybitKeyMissingPermission` has no `{{kind}}` (F18); refusals in the order of spec section 6.8 (O13, PLANNER CALL 25), all before any Keychain write; `bybitConnectLimits` and `bybitKinds` before the
  inputs; `BYBIT_API_MANAGEMENT_URL` = https://www.bybit.com/en/app/user/api-management in the env files, and `www.bybit.com` in `scripts/privacy-site.js` `NON_REQUEST_HOSTS`
  in this same step. Rows A12, A13, A32, A33, A54 (C3: the exact URL). `bybitConnectLimits` and `bybitKeyRejected` carry the C1
  text. Check: `npm run privacy:site -- hosts` does not list `www.bybit.com`.
- [ ] **step 2/6: wiring.** `exchange-catalog.ts` id and row before `other`, `exchange/registry/registry.ts` entry with
  `notListedKey`; an optional registry field that `ExchangeHistoryFooter` reads for `earlierHistory`, set on Binance only, so its line stays byte-identical (PLANNER CALL 27, A59); `crypto-sync-form.component.tsx` arm, `crypto-sync-section.component.tsx` connect callback,
  `account-form.screen.tsx` and `use-connect-reminder.ts` per-provider props, `clearPairIfRowMissing` for Bybit. Re-pin
  `exchange-catalog.test.ts`, `registry.test.ts`, `crypto-sync-section.component.connect.test.tsx`, naming O9. Row A43,
  red on the parent, where `bybit` has neither entry (O21). Row A55 (C4: the caption). The footer of `notListedKey` carries the
  C1 text, and clauses F2, F3 and "older than two years". `statistics.bybitPastLimits`, clause L1S (PLANNER CALL 69; was: L1 word for word): a registry field beside the `earlierHistory` one; `netWorthCard` in `statistics.screen.tsx` shows the line under `NetWorthLine` when `filtered.filteredAccounts` holds a provider with that field, caption tone, theme tokens only (PLANNER CALL 45, F14). Row A78. Grep `en.casing-by-role` and uk first. Owed from the set 4 review: a component test of a Bybit pick through the switch gate (`pick: string` stays until the catalog holds Bybit, so the test cannot run before this step).
  Owed from the set 4 last round: the create form must show the provider's refusal text on a failed first Connect. Today `account-form.screen.tsx:433` takes only `sync` from `useCryptoSync`, so the `error` from `use-sync.ts:66` is lost, and `binance-credentials-field.component.tsx:137-141` shows only the generic `couldNotConnectBinance`. A Bybit field built on that pattern would hide `bybitForbidden`, `bybitComplianceRefused`, `bybitKeyRefused` and the other refusal texts, which `bybit.failure-text.ts` writes for the user. Row A127: a test over the real Bybit provider, with a refusal answered by the client, shows that refusal's text in the create form, and not the generic text. Binance's own form has the same gap. Another track owns Binance, so this step does not change it.
- [ ] **step 3/6: help and shipped copy.** Grep the help pins, `en.casing-by-role`, and uk first; in ONE step edit
  `help-topics.ts` (a sixth step key), en, uk, `help-topics.test.ts` (count 6, step 3 still Binance). The keys of steps 4 and
  5 move: per harness-workflow "Removing or renaming a catalogue key", every dependent edit stays in this step. The step text
  ends with the shipped `bybitKinds` text, and it carries the C1 text. `bybit.shipped-copy.test.ts`, one row per kind set (O15).
  Clause "E2 and E4" lands here, in `bybitKinds`, the footer and the help step (O75, PLANNER CALL 85, `texts-for-review-o76.md`), with `BYBIT_PHRASES` in `en.casing-by-role.test.ts` re-read and changed in this same step as the `bybitKinds` edit. Rows A40, A51 (C1: the four surfaces, en and uk), A83 (clauses L1 and L1S, O64, O66), A97 (F3 and L1, O65).
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
- [ ] **step 6/6: device check, user on device, one build (O75; was: two, PLANNER CALL 34; spec section 10).** The coordinator owns device builds. The coordinator merges current `next` into this tip first, so its journal holds every migration of `next` and none that `next` lacks (F3, PLANNER CALL 72), then this tip, `make deploy EXPECT=api.bybit.com`. The empty account with Last sync; the expiry line with 2027-02-04; each surface in section 6.4, `statistics.bybitPastLimits` too; connect in 10 calls; a wrong key; a read-write key; a key refused on a route (a narrow key, made and deleted by the user, optional); disconnect and reconnect; Binance still syncs; light and dark. Positive and negative pin checks of `docs/security/README.md`. Guard: A52 pins that no tracked env file, plist entry or source module names `api-testnet`. This check is "fundamentals done" (O44), the next device call for Bybit. It proves the connect path, the expiry, an empty read from a live answer and every stated limit. It does not prove a coin row, a set-aside line from a live answer, or any history row, which no build can show: those are the accepted residuals of spec section 10 (O64, O75, O76), and the report says that no coin row was seen. O73 does not block this build (O76). A defect in data, a stated limit or a condition blocks it. A visual wish does not block it: it goes to fast visual rounds after it, on this branch, before the batch merge. Pass: those rounds, then the batch merge. A stop here: sets 3 to 7, 9 and 10 stay out of `next`, and no removal row is needed, because the batch holds no migration: the table is already in `next`, so a phone's count never passes `next` (was: stated with the migration in set 10, which was false, F3).

## 1.4-bybit set 8/11: skill drift

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

A recommendation to the coordinator, who owns the merge (O21, PLANNER CALLS 43, 59). Sets 3 to 6, 9, 10 and 7 stay out of `next` until set 7 passes on device,
then merge as one batch, so no dormant reader of Bybit reaches `next`. The empty table of set 2 has no reader but the backup path. If set 7 stops, no removal row is needed, because the batch holds no migration (F3; was: the same words, false while set 10 held it); set 2 holds no Bybit
id and may stay, with its empty table until a later release drops it (spec PLANNER CALL 72). The cost is one larger merge.

The device pass is "fundamentals done" = set 7's device check, step 6/6 (O44). Fast visual rounds come after it, on set 7's branch,
before the batch merge; a visual wish does not block the pass, and a defect in data, a stated limit or a condition does.

Order into `next`: 2 alone, with the empty table, before any device build of this track; then the batch 3, 4, 5, 6, 9, 10, 7 after the device pass and the visual rounds; then 8. O62 removes no set: it removes
the wait for R2 to R4 before set 2, so set 2 can merge once this commit is its base. The batch holds clause "E2 and E4" (O75). Nothing ships hidden at any merge (2.5.19): set 2 has no id,
and the way in comes last.

Set 1 merges nothing but its spec edit. Each set tip has its queued verify, and the merged tip of each merge has a queued
verify green. `1.4-light-scheme` may land first: theme tokens keep sets 4 and 7 unaffected.

## Sizes

| Set | Code lines (about) | Code files | Test lines (about) |
|---|---|---|---|
| 1 | script 1,379, measured, plus the host choice and a floor of 220 for P8, P9 and P19 (was 210) | 1 | 1 fake-curl test, plus a floor of 390 (was 370) |
| 2 | 270, and 1 migration (was 210, no migration) | 15-18 (was 9-12) | 650 (was 450) |
| 3 | 1,270 | 25-29 | 2,350 |
| 4 | 550, plus a floor of 200 for steps 5/9 to 9/9 | 13-15, plus 15-18 touched by steps 5/9 to 9/9 (a floor; many overlap) | 1,050, plus a floor of 450 |
| 11, runs before 5 | 45 | 8-10 | 350 |
| 5 | 1,060 (was 1,050) | 7-9 | 2,060 (was 2,040) |
| 6 | 500 | 5-6 | 1,300 |
| 9, runs before 7 | 990 (was 950) | 12-15 | 2,240 (was 2,170) |
| 10, runs before 7 | 935, no migration (was 910, and 1 migration) | 12-15 (was 18-21) | 2,855 (was 2,730) |
| 7 | 570, plus copy, the policy and site pages | 18-22 | 1,170 (was 1,160) |
| 8 | docs | | |

Totals for sets 2 to 7, 9, 10 and 11: about 6,190 code lines, 115 to 139 code files, about 14,025 test lines (was: 6,145, 107 to 129, 13,675, before set 11; before that 6,010, same, 13,250, before the O68 fix round; before that 5,880, same, 12,790, before the O66 fix round; before that 4,950, 89 to 108, 10,010).

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
set 7 header, step 6, "Merge order", spec status, sections 1, 3, 6.4, 8, 9, 10, 12, 13, Backlog. A later step number here that says "of 7" for set 1 now reads "of 11", and for set 3 "step n/7".
O63 (a) spec section 12; (b) spec rules 13, 14, 19, 47, set 5 step 4; (c) set 7 step 6, spec section 10; (d) spec rule 15, section 3 "Safe readings", section 10; (e) status, set 1 header. O64 status, goal, set 9, set 1 steps 8, 9, 10, 11, set 7 header, steps 1, 2, 6, "Merge order", spec status, sections 1, 2, 3, 5, 6.4, 6.8, 8, 9, 10, 11, 12, 13, Backlog.
O65 status, goal, set 10, set 1 steps 9, 10, 11, set 2 step 1, set 7 header, steps 1, 2, 3, 6, global constraints, "Merge order", Sizes, Backlog, spec status, sections 1, 2, 3, 5, 6.4, 6.5, 6.8, 8, 9, 10, 11, 12, 13, Backlog.
Review of 7a2391ca8: F1 set 7 step 6, spec section 10; F2 spec rules 13, 14, 19, 47, A18, A35, PLANNER CALL 37; F3 spec section 13; F4 spec section 3; F5 spec rule 15, section 3 "Safe readings", section 5, section 10; F6 spec section 3, A60; F7 status, set 1 header, spec section 13; F8 spec section 6.8, section 10, CALL 25, set 7 step 1, A32; F9 spec rule 42, set 6 step 1; F10 spec section 3, A60, A82, set 5 step 3; F11 set 7 step 6, spec section 10; F12 spec section 9, A44; F13 spec section 10; F14 spec sections 1, 6.4, 8, A78, set 7 step 2, PLANNER CALL 45; F15 spec rule 26, section 8; F16 spec sections 12; F17 spec sections 8, 11, 12, set 1 step 10; F18 spec sections 4, 6.8, 8, A32, set 7 step 1.
Review of 32337df0d, ruled by O66: N1 set 5 step 2, set 9 step 3, set 10 step 4, spec section 5, PLANNER CALL 63; N2 set 1 step 11, set 9 steps 2, 3, spec section 3, PLANNER CALL 64; N3 set 9 step 3, PLANNER CALL 65; N4 set 9 steps 1, 4, PLANNER CALL 66; N5 set 1 step 11, set 9 step 4, set 10 step 2, PLANNER CALLS 67, 68; N6 set 9 steps 3, 4; N7 set 7 step 4, spec section 9; N8 set 7 step 3, spec section 3, PLANNER CALL 69; N9 set 5 step 4, A35.
O75: status, set 1 header, steps 8 to 11, set 3 header, step 7, set 4 step 5, step 6, set 7 header, steps 1, 3, 6, "Merge order", spec sections 1, 2, 3, 4, 5, 6.4, 6.8, 8, 10, 11, 12, 13, Backlog. O76: set 1 step 10, set 4 steps 7, 8, 9, set 6 step 1, set 7 step 6, spec rules 6a, 6b, section 3, section 8, section 10, section 12 (PLANNER CALLS 32, 77 to 82, 84). O67: status, set 1 step 10, spec sections 3, 10, 12, 13. Review of d80d46d02, ruled by O68: F1 set 10 step 2, spec section 3, section 11 (Q10, Q11, Q12, A105), PLANNER CALL 70; F2 set 10 step 5, spec section 3, A87, M33, PLANNER CALL 71; F3 global constraints, set 2 header, step 5, set 7 step 6, set 10 header, step 1, "Merge order", Sizes, spec sections 10, 11, 13, PLANNER CALL 72; F4 set 5 step 2, set 9 steps 1, 3, 5, set 10 step 4, spec sections 3, 5, 6.4, 8, A106, Q9, PLANNER CALL 73; F5 set 1 step 10, spec sections 3, 10, 13, M35, PLANNER CALL 74; F6, F7 set 7 step 3 through A83, spec section 8; F8 set 10 steps 2, 5, spec sections 3, 5, A107, PLANNER CALL 71; F9 set 1 step 11, set 10 step 4, spec section 3, P19, A86; F10 set 10 step 2, spec section 3, M34; F11 spec section 3, A87; C1 set 2 step 5, set 7 step 4 through A44, set 10 steps 2, 4, spec sections 3, 9, PLANNER CALL 75. O68 (c), (d): spec section 13. Set 2's steps 1 to 4 keep their numbers, now "of 5".

Acceptance rows: A1, A2, A5 to A7, A11, A31, A48, A58 set 3 step 5; A3, A4, A36, A37, A47 set 3 step 7; A57 set 6 step 2; A59 set 7 step 2; A60 set 5 step 4; A61 set 5 step 2; A62 set 3 step 2; A8, A38 set 3 step 4; A9, A10 set 3 step 2; A14, A16 set 4
step 1; A15 set 3 step 2, set 4 step 2; A17 to A22, A27, A30, A35, A39, A41 set 5 step 4; A23 to A25 set 6 step 1; A26 set 4
step 1, set 6 step 1; A28 set 4 step 4; A29 set 4 step 3; A12, A13, A32, A33 set 7 step 1; A34, A46 set 3 step 5, set 4 step 2;
A40, A51 set 7 step 3; A42, A49 set 3 step 6; A43, A55 set 7 step 2; A44, A50 set 7 step 4; A45 set 4 step 2; A52, A53 set 3
step 2; A54 set 7 step 1; A56 set 3 step 3; A63 set 9 step 2; A64 to A71 set 9 step 3; A72 to A75 set 9 step 4; A76 set 9 steps 3, 4; A77 set 9 step 5; A78 set 7 step 2; A79, A81 set 9 step 1; A80 set 9 steps 2, 3, 4; A82 set 5 step 4; A83 set 7 step 3; A127 set 7 step 2. Q8 set 9 step 3; Q9 set 9 step 5. A84 set 10 step 2; A85, A86 set 10 step 4; A87 set 10 steps 3, 5; A88 set 2 step 5, set 10 steps 1, 5; A89 to A95 set 10 step 6; A96 set 2 step 5 (was: set 10 step 1); A97 set 7 step 3; A105 set 10 step 6; A106 set 9 steps 3, 5, set 10 step 4; A107 set 10 step 5. A98 set 5 step 2 for the split, set 9 step 3 for the plain hint; A99, A100 set 9 step 3; A101 set 10 step 5; A102, A103 set 9 step 4; A104 set 9 steps 3, 4. Q10, Q11, Q13 set 10 step 5; Q12 set 10 step 2. Set 7's A32 now counts 10 calls (O75; was: 10, 11 or 12). A3, A4, A36, A37, A47 are not built (O75). A108 to A116 set 4 step 7; A117 set 4 step 8; A118 set 4 step 9; A119 set 4 step 6; A120 set 6 step 1. A121 set 11 step 1; A122 set 11 step 2; A123, A124 set 11 step 3; A125 set 11 step 4; A126 set 11 step 5. O78, O83 finding 2: set 11, spec section 3, section 13 (Q-i), PLANNER CALLS 86 to 89.

## Backlog

### Later, no date, the user's choice: one real deposit and withdrawal (O61 (b), O62)

R2, R3 and R4 with real money. No set waits for them. They turn stage B's docs-only rows into MEASURED; the rows and parts are in the spec's Backlog.

### Backlog of set 4's review (O80, O83), at the next touch

F6 (a state text that is not JSON, or a failed row query, shows "No holdings yet"; no writer makes it), F9 (code 10010 shows "Bybit request failed: 10010"), and the twin tests of `exchange-history-gate.test.ts` (re-review finding 6).

### Deferred: the rest of stage C, and stage D (O37, O64)

Not in the numbered list, and not built in 1.4. A later track gives each its own sets and detail. The tables, R5, R6,
the part P10, the call counts and the copy edits are in the spec's Backlog.

- The rest of stage C: interest, bonus and airdrop rows on the walk of set 9, with no new call. Was: the whole of stage C, now set 9.
- Stage D, Earn orders and yield. Needs P10 (R6). Expected: `earn` walk id, flexible orders, yield per category, floor
  `now - 90 days`, own lane under the gate. Size floor: 500 code lines, under 10 files. Copy edits in the same set.
  Reviewer: what the 3-month floor drops, stated in copy.
