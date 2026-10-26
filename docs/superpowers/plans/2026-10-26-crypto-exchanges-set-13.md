# Crypto exchanges 1.3-a, change set 13: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax.

**Status:** APPROVED 2026-10-26. Every S13-Q* is ruled (see "Rulings" at the end). Set 13 builds only after
set 12 is on main.

**Goal:** land `crypto-exchanges-1.3-a task 13/15`: the read-time bank-debit matcher (R-Q14), its exclusion
from spending, and the "Matched to ..." caption on a matched bank debit.

**Architecture:** a pure function `exchangeFundingMatches(ledger)` in `src/statistics/exchange-funding-match/`
(new) returns the matched pairs (bank row id -> exchange row id and kind) and the exclusion set.
`statistics.screen.tsx` unions that set with the other exclusion sets (`excludedTransactionIds`); nothing is
written. A hook beside it runs the same function over the same ledger query for the transaction form's
caption. Model the bucket search (currency + amount buckets, time-sorted, binary search on the window) on
`internalTransferTransactionIds` (`src/statistics/internal-transfers/internal-transfers.ts`); model the caption
on the loan field's `autoLinkedCaption` (`src/screens/forms/loan-payment-field/`) and its route through
`ModeAndActions` (`src/screens/forms/transaction-form/mode-and-actions/`).

**Tech stack:** React Native, op-sqlite + Drizzle, Jest (property cases through `seededRandom` from
`@kiko/test-support/seeded-random`; `fast-check` is not installed), fnts `maybe`/`Either`, ts-pattern.

**Spec:** `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md`: "Read-time bank-debit matcher (R-Q14,
set 13)", "Matcher (set 13)" (M1-M14), section 10 copy rows `transactions.matched*`, section 9 "Demo `.kiko`"
("a matching bank debit on a bank account so the statistics matcher shows (set 13)"), section 11 row 13/15,
section 1 R-Q14, S7-Q3, S7-Q5, S7-Q8, S12-Q10 (CLOSED 2026-10-26, superseded by this matcher, S13-Q1), S12-Q17.
Rulings: `rulings.md` (main checkout, `memory/refs/binance-multicoin-sdd-2026-10-21/`), "SET 13 PLAN RULINGS".

**Base:** set 13 starts from main after set 12 merges (today: `binance-set12` at d292d240 = set 12 + main
73a07ecd, which carries loan-r3 "rule fix B"). Every code fact names a symbol or anchor text, never a line.
**The developer re-greps every fact on the actual base before relying on it.** Counts below are floors; the
developer measures.

## 1. Goal and scope (SCOPE RULE, user 2026-10-25)

| Item | Class | In set 13 |
|---|---|---|
| M1-M14: a bank debit that funded a P2P buy, card buy or fiat deposit leaves spending (Expenses by category and the category trend) | (a) wrong amount the user sees (the debit counts as spending today, "was: counts") | yes |
| Caption `transactions.matchedP2pPurchase` / `matchedCardPurchase` / `matchedExchangeDeposit` on a matched debit | (c) caption; the visible reason a debit left spending | yes |
| en + uk copy with translator review | compliance (ship) | yes |
| Demo bank debits so the caption is reachable (2.5.19) | compliance (ship) | yes |
| No regression of existing exclusion (2-minute matcher, MCC, description, exchange marker, loan payments) | (b) regressions the set could introduce | yes (pins kept green, M12 and M13 pin the overlap) |
| Help topic `'7'` sentence on what does not count as spending (S13-Q6) | (c) accurate text | yes |
| P2P cover rule (S12-Q10): an outgoing USDT row covered by an earlier P2P buy | CLOSED 2026-10-26, superseded by the matcher (S13-Q1 = A, USER) | no; no step builds it |
| W1/W2 withdrawals (R-Q12) | not set 13: spec row 6/15 owns them; W1 is pinned by `binance.transactions.placement.test.ts`, "imports a USDT withdrawal as spending in the default category" (developer re-greps; W2 is today's hand link, no change) | no |

BACKLOG (to `memory/refs/binance-multicoin-sdd-2026-10-21/backlog-after-1.3.md`, one line each, by the
coordinator; accepted 2026-10-26):
- S13-B1: a narrowed (time-windowed) ledger query for the form's caption hook instead of the full ledger read;
  speed only, the full read gives the same answer as the statistics screen (S13-Q4).
- S13-B2: the caption on list rows (transactions list, holding detail); the spec puts it on the form only.
- S13-B3: an index or query for the matcher's bank side; speed only, no migration in 1.3-a.
- Every set 12 backlog item stays there unchanged; set 13 touches none of their paths.

## 2. Global constraints

- G-1 TDD: failing test first, shown red (quote the red count), then code. Titles and comments carry no
  scenario id, ruling id or history; the commit message carries them. Tests never parse `src` text.
- G-2 A pin this set moves is updated in the same step and retitled to the new rule, never in a fix round.
  Expected moves: none outside this set's new files (the screen and form suites gain new files, not edits); if
  an existing statistics pin turns red, stop and report it (it is a regression, class (b)).
- G-3 Full-word identifiers; `@kiko/<feature>` barrels; every new export has a consumer at its own commit
  (knip); `ts-pattern` `match().exhaustive()` over the three kinds (`p2p`, `card`, `bank`), never an if-chain.
- G-4 No migration, no index, no `.kiko` shape change (`EXPORT_VERSION`, `VERSION_DECISIONS` unchanged): no
  migration review, no EXPLAIN QUERY PLAN test. Stop and ask if one appears. The demo `.kiko` files are
  regenerated for new ROWS only (step 6/8).
- G-5 Amounts: the total comes only from the code through `parseUntrackedCounterpart`
  (`src/transactions/untracked-counterpart/untracked-counterpart.ts`, C-NR1, S7-Q3); compare integer minor
  units exactly (`bank.amountMinorUnits === -total`); never `Number()` on a text, never a float, never
  `operation` (S7-Q5).
- G-6 Windows are named constants in the new module (P2P `[t - 1 h, t + 2 h]`, card `[t - 1 day, t + 3 days]`,
  fiat deposit `[t - 5 days, t + 1 h]`, both edges inclusive; the developer quotes the spec on inclusivity and
  pins both edges).
- G-7 Guideline 2.5.19: no flag, no `SHOW_*`/`HIDE_*`, no hidden UI; the caption is reachable in the demo
  (step 6/8).
- G-8 Every commit passes the pre-commit typecheck; Bash `timeout: 300000` for commits; never `--no-verify`.
  `statistics.screen.test.tsx` and `transaction-form.screen.test.tsx` are over 1000 lines: add NO test there;
  new tests go into the new files named below. `bash scripts/checks/dup.sh <file>` alone on each new test file.
  Writes to `src/`, `e2e/` and `docs/` only with Edit/Write. After any `biome check --write`, run
  `node scripts/checks/import-order.js <file>`.
- G-9 Jest lines: literal paths FIRST, `--testPathIgnorePatterns=.stryker-tmp` LAST (`=` form); never an empty
  path list or a glob. Model: `npx jest src/statistics/exchange-funding-match/exchange-funding-match.test.ts
  --testPathIgnorePatterns=.stryker-tmp`.
- G-10 A mutant is never restored with git: hand-apply with Edit, run, quote the red count, Edit back, then
  `git diff --exit-code -- <file>` exits 0.

## 3. Run-log gaps (`run-log.mjs stats --gaps --repo kiko`, read 2026-10-26)

Set 13 closes none. Left open, each unrelated or not on a set 13 path:
- `20261017T1639-kiko-binance-backfill-fix/1` (walk-state gate checks institution, not connection): open; no
  walk change.
- `20261021T1839-kiko-binance-set9/1`, `/2` (unreadable `notImported` names; repeated rounding warning): open;
  no sync change.
- `20261023T0356-kiko-binance-set12/1`, `/2` (S12-Q42/Q45 fiat bounds): open, in the backlog.
- `20261015T1657-kiko-binance-backfill-fix/2` (migration index check): open; no migration (G-4).
- TIMEOUT-HEAVY (`20261015T1119-kiko-harness-h7/2`, `20261017T1639-kiko-binance-backfill-fix/7`,
  `20261018T1637-kiko-harness-h9/2`): open; if the gate mutates `src/i18n/locales/{en,uk}.ts` lines (imported
  app-wide), step 8/8 applies the gate's own rerun rule.
- Every other gap (harness, kill-guard, Duo, iPad, account-currency, loan, empty-selectors): open, unrelated.

## 4. Decisions this plan makes (ruled 2026-10-26)

- Input: `ledgerWithCurrency` (unfiltered, every holding, both signs) plus the account kind per holding (from
  the accounts the screen already reads, `accountsRepo.listQuery()`), so the account filter never brings a
  debit back (M11).
- Exchange side: a row whose `untrackedCounterpart` parses to kind `p2p`, `card` or `bank` with a total, and
  whose amount is positive. Card sell and fiat withdraw (negative) never match.
- Bank side: every negative row on a holding whose account kind is not `crypto` (an implicit or missing
  account counts as not crypto; developer re-greps `accountDisplayName` / implicit accounts), in the holding's
  currency, whatever its category, MCC, description, markers or `categorySetByHand` (M12, M13, S13-Q3).
- Match: currency equals the code's fiat; `amountMinorUnits === -total`; the bank row's time inside the
  kind's window around the exchange row's time.
- One-to-one: candidate pairs sorted by (1) transfer-like bank row first (MCC 4829 or 6012, or a stored
  description containing `BINANCE` case-insensitively, S13-Q8), (2) absolute time gap, (3) bank row id,
  (4) exchange row id; greedy, each row once. Then an augmenting-path pass inside each (fiat, amount) bucket
  that only adds pairs: every greedy-matched row stays matched (its partner may change), so the excluded set
  only grows (S13-Q10 = B, USER).
- Output: `matches: Map<bankId, { exchangeId, kind }>` and `excludedIds`: the matched bank ids whose
  `categorySetByHand` is false. The caption shows only for a bank id in `excludedIds`.
- `exchangeExcludedTransactionIds` is unchanged: a `p2p:` row stays out (S13-Q2).
- No P2P cover rule: an outgoing USDT row counts once, in its own category (S13-Q1 = A).
- Caption hook: `useExchangeFundingCaption(transaction)` in
  `src/statistics/exchange-funding-match/use-exchange-funding-caption/` (folder per thing); its ledger,
  holdings and accounts queries run only when the edited row is negative and on a non-crypto holding
  (`useLiveQuery`'s enabled flag; kiko-architecture "`paused` vs `enabled`"), returns the copy key or
  undefined (S13-Q4). The developer checks kiko-architecture for a hook inside `src/statistics/`; if a rule
  places hooks elsewhere, follow it and say so in the step report.

## 5. Scenario matrix (each row is a Jest case; titles exact)

`ef` = `src/statistics/exchange-funding-match/exchange-funding-match.test.ts` (new),
`screen` = `src/screens/statistics/statistics.screen.exchange-funding.test.tsx` (new),
`form` = `src/screens/forms/transaction-form/transaction-form.exchange-funding.test.tsx` (new),
`demo` = `e2e/screenshot/fixtures/build-demo-snapshot.test.ts`. UAH and EUR scale 2. "was:" is the spec's.

| Row | Test (file, title) | Exact values | Result | was: |
|---|---|---|---|---|
| M1 | ef, "matches a P2P purchase to the bank debit of its exact total twenty minutes earlier"; form, "shows Matched to P2P purchase under the category of a matched bank debit" | `p2p:UAH:4150.00`, +9_990_000_000 USDT at t; -415_000 UAH at t - 20 min | debit in `excludedIds`; caption | counts |
| M2 | ef, "leaves a debit of the total two hours before a P2P purchase unmatched"; ef, "matches a $kind debit at each edge of its window and not one millisecond past it" (each kind, both edges) | -415_000 at t - 2 h | counts | counts |
| M3 | ef, "leaves a debit one minor unit off the total unmatched" | -415_001 | counts | counts |
| M4 | ef, "matches one debit to the nearer of two P2P purchases of the same total" | buys at t and t + 30 min; debit at t + 25 min | one match, the second buy | counts |
| M5 | ef, "matches a card purchase to a debit posted two days later" | `card:UAH:2600.00`; -260_000 at t + 2 days | excluded | counts |
| M6 | ef, "matches a fiat deposit to a debit three days earlier" | `bank:EUR:100.00`; -10_000 EUR at t - 3 days | excluded | counts |
| M7 | ef, "counts a debit no exchange row funded" | no coded row; -415_000 | not matched | counts |
| M8 | ef, "leaves a debit in another currency than the total's fiat unmatched" | debit -415_000 on a USD holding | counts | counts |
| M9 | ef, "matches a hand-categorized debit but keeps it out of the excluded ids"; form, "shows no caption on a matched debit the user categorized by hand" | `categorySetByHand` true | counts; no caption | counts |
| M10 | ef, "prefers a transfer debit over a nearer grocery debit"; ef, "treats a debit whose description holds binance in any case as a transfer" | grocery at t - 5 min, MCC 4829 at t - 30 min | 4829 excluded; grocery counts | counts |
| M11 | screen, "leaves the funding debit out of spending while the account filter hides the crypto account" | M1 with the crypto account filtered out | debit not in the pie | counts |
| M12 | ef, "lets an already excluded cash-out debit take the match, so the grocery debit still counts"; form, "shows the caption on a matched debit another rule already excludes" | MCC 6012 at t - 30 min, grocery at t - 5 min | 6012 consumed, caption; grocery counts | 6012 excluded; grocery counts |
| M13 | ef, "lets a hand-categorized debit take the match, so the grocery debit still counts"; form, "shows no caption on a hand-categorized debit that took the match" | hand row (MCC 4829, transfer-like) at t - 30 min, grocery at t - 5 min | hand row as set, no caption; grocery counts | hand row as set; grocery counts |
| M14 | ef, "matches a P2P purchase of a fiat asset to its bank debit"; ef, "never takes a debit on a holding of a crypto account" | `p2p:UAH:4000.00` +400_000 on "Binance Funding · UAH"; -400_000 on a bank card; a -400_000 UAH row on a crypto holding | bank-card debit excluded, caption; crypto-holding row never bank side | counts |
| T1 (tie-breaks, spec row 13/15) | ef, "breaks a tie by the time gap, then the bank row id, then the exchange row id" (one case per key, each key the only distinct value) | - | the expected pair per key | - |
| T2 | ef, "ignores a coded row with no total, a negative amount, or a wallet or asset code" | `p2p:UAH` (no total), `card:UAH:1300.00` at -1_300_000 ETH, `asset:PEPE` | no match | - |
| T3 (property) | ef, "matches each row at most once and gives the same pairs for any input order" (`seededRandom`, generated ledgers) | - | invariants | - |
| M15 | ef, "matches both debits of two P2P purchases of the same total when the nearest pair would leave one unmatched" | `p2p:UAH:4150.00` buys at t and t + 90 min; -415_000 at t + 40 min and t - 50 min | both debits in `excludedIds` (t - 50 with the first buy, t + 40 with the second) | counts (one) |
| T4 (wiring) | screen, "keeps a matched debit out of the category trend too" | M1 | trend bucket without it | counts |
| T5 (wiring) | screen, "still counts a debit the matcher leaves unmatched" | M3 | in the pie | counts |
| D1 | demo, "shows a matched bank debit for each funding kind" (through `exchangeFundingMatches` over the snapshot) | three demo debits | three matches, each in `excludedIds` | - |

S12-Q17 is S13-Q2 (ruled A: a `p2p:` row stays out of statistics).

## 6. Interaction with rule fix B (main d292d240, loan-r3)

Rule fix B removed `exchangePairId`, `exchangeCounterpartHoldingId` and `untrackedCounterpart` from
`REWRITE_GUARD_FIELDS` (`plan-rule-rewrite.ts`) and matches a blank row by `ruleDescriptionOf`. Findings:
- Exchange side: a rule writes only `category` (and on the rule-save source row, `categorySetByHand`). The
  matcher reads the code, amount, time and holding, never the exchange row's category or hand flag. A rule's
  rewrite of a `p2p:`/`card:`/`bank:` leg changes nothing the matcher matches. Exclusion of the leg itself stays
  `exchangeExcludedTransactionIds` by marker. Pinned by T2 plus one ef case: "matches a P2P purchase whatever
  category a rule gave it".
- Bank side, M9 / M13: a rule never sets `categorySetByHand` true on an insert, rewrite or refresh, so a
  rule-categorized debit stays in `excludedIds` (caption shown). One exception, pre-existing and not on a
  changed path: saving a rule FROM a source row sets that row's `categorySetByHand` to `isOutRanked`
  (`category-rules.repo.ts`, the source-row update). An outranked rule saved from a matched debit makes it a
  hand row: it then counts and loses its caption (M9 applies). Accepted, no change (S13-Q9, USER).
- Bank side, description priority: the matcher reads the STORED description for `BINANCE`, not
  `ruleDescriptionOf` (a bank debit is not a leg; a blank manual row's label is a category or default text,
  never "Binance"). S13-Q8.
- M12: rule fix B does not touch MCC, description or the 2-minute matcher inputs; an already excluded debit
  stays excluded and still takes the match.

## 7. Compliance

- Copy (section 10): `transactions.matchedP2pPurchase` "Matched to P2P purchase." / «Зіставлено з купівлею
  через P2P.» (S13-Q7; spec row today reads «Зіставлено з купівлею P2P», step 4/8 changes it);
  `matchedCardPurchase` "Matched to card purchase." / «Зіставлено з купівлею карткою.»;
  `matchedExchangeDeposit` "Matched to exchange deposit." / «Зіставлено з поповненням біржі.». Each ends with "."
  because a caption under a form field always does (kiko-translator "Final '.' follows one rule per UI role too";
  orchestrator ruling s13-o3, 2026-10-26, like `loanLinkedAuto` "Linked automatically."). Translator review
  (kiko-translator: parity test, caption casing and full-stop rule per UI role, uk sentence case, U+02BC). The
  uk P2P caption goes on the user's uk review list (release step 6).
- 2.5.19: no flag; the caption is reachable in the reviewer's demo (step 6/8: three debits, D1). The
  Notes-for-Review duty: set 15 writes the Notes; spec section 9 already has "A bank card payment that funded a
  P2P purchase is not counted as spending and shows "Matched to ..."" (step 7/8 checks it names all three
  kinds).
- Help text (help topic `'7'` in `src/i18n/locales/en.ts`, "... do not count as spending"): step 4/8 adds one
  sentence naming a bank payment that funded a P2P purchase, a card purchase or an exchange deposit, en + uk,
  translator review (S13-Q6).
- No privacy change: nothing leaves the device, no new data stored.

## 8. Files (measured floor; the developer measures the real list)

Mutable source files, at least 6, cap 30: `src/statistics/exchange-funding-match/exchange-funding-match.ts`
(new), `.../use-exchange-funding-caption/use-exchange-funding-caption.ts` (new),
`src/screens/statistics/statistics.screen.tsx`, `src/screens/forms/transaction-form/transaction-form.screen.tsx`,
`.../mode-and-actions/mode-and-actions.component.tsx`, `src/i18n/locales/{en,uk}.ts` (if counted). Spec row 13/15
says about 6. The number that counts: `KIKO_MUTATION_BASE=<set 13 base sha> make mutable` (step 8/8).

---

### step 1/8: the pure matcher, one pair at a time

Class (a). Files: `src/statistics/exchange-funding-match/{exchange-funding-match.ts,exchange-funding-match.test.ts,index.ts}` (new).
- [ ] Red first: M1, M2 (both titles), M3, M5, M6, M7, M8, M14 (both titles), T2, and "matches a P2P purchase
      whatever category a rule gave it" (section 6). Quote the red count.
- [ ] Code: buckets by (fiat, amount), the three window constants, `match` over the kind.
- Check: the ef file green; `bash scripts/checks/dup.sh` on it; knip clean (the barrel export has no consumer
  until step 3/8: export only from the module file in this step, add the barrel in step 3/8).
- Estimate source: nearest run-log rows are the loan-payment matcher sets (`kiko-loan-*`); the estimator
  measures.

### step 2/8: one-to-one, priority, hand and excluded rows

Class (a). Files: same as step 1/8.
- [ ] Red first: M4, M9 (ef), M10 (both), M12 (ef), M13 (ef), T1, T3.
- [ ] Code: global candidate sort, greedy consume, `excludedIds` without hand rows.
- Check: ef green; mutation by hand (G-10) on each sort key (swap the key order, drop the `BINANCE` lowering),
  red count quoted.
- Estimate source: no similar row.

### step 3/8: statistics wiring

Class (a) and (b). Files: `src/screens/statistics/statistics.screen.tsx`, `screen` test (new), the barrel.
- [ ] Red first: M11, T4, T5, and M1 through the screen ("leaves a matched funding debit out of the spending
      pie").
- [ ] Code: a `useMemo` over `ledgerWithCurrency` and the account kinds; `excludedIds` joins
      `excludedTransactionIds`. Comment WHY only (no history).
- Check: the new screen file green; then `statistics.screen.test.tsx` and
  `src/statistics/internal-transfers/internal-transfers.test.ts` and
  `src/statistics/exchange-exclusion/exchange-exclusion.test.ts` green unchanged (G-2).
- Estimate source: no similar row.

### step 4/8: copy and help text

Compliance. Files: `src/i18n/locales/{en,uk}.ts` (three `transactions.matched*` keys; the help topic `'7'`
sentence, S13-Q6), `docs/superpowers/specs/2026-10-15-crypto-exchanges-design.md` (section 10 row
`transactions.matchedP2pPurchase`: uk cell to «Зіставлено з купівлею через P2P», S13-Q7, in the SAME commit as
the catalogue key).
- [ ] Red first: the i18n parity test fails with the keys in one catalogue only (quote it), then both.
- [ ] Tests that read the uk P2P caption assert «Зіставлено з купівлею через P2P.» (final "." per s13-o3).
- [ ] Translator review (kiko-translator "Review new/changed keys before a shipping deploy"), the three keys
      and the help sentence.
- Check: parity and catalogue tests green; `npm run check:component-i18n-namespace`;
  `__tests__/docs-known-limit.test.ts` and `__tests__/spec-test-rows.test.ts` green after the spec edit.
- Estimate source: set 8's copy step (`kiko-binance-set8`); the estimator measures.

### step 5/8: the caption

Class (c). Files: `use-exchange-funding-caption/` (new, hook + test), `mode-and-actions.component.tsx` and its
props, `transaction-form.screen.tsx`, `form` test (new).
- [ ] Red first: M1 (form), M9 (form), M12 (form), M13 (form), "shows no caption on an unmatched debit", and
      "reads no ledger for a row on a crypto holding" (the hook's queries disabled).
- [ ] Code: the hook returns the key per kind (`match().exhaustive()`); `ModeAndActions` renders it under the
      category picker the way `LoanPaymentField` renders `autoLinkedCaption` (shared Text component and
      tone; kiko-design-system caption rules); the developer re-greps the slot first.
- Check: form and hook tests green; `transaction-form.screen.test.tsx` and
  `transaction-form.set-category.test.tsx` green unchanged; the designer confirms the caption against the
  loan caption (no new visual).
- Estimate source: no similar row.

### step 6/8: demo debits

Compliance (2.5.19). Files: `e2e/screenshot/seed/screenshot-seed.ts` (and `demo-text.ts` if a description is
needed), `build-demo-snapshot.test.ts`, both `kiko-demo-{en,uk}.kiko` regenerated
(`KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts --testPathIgnorePatterns=.stryker-tmp`).
- [ ] Red first: D1.
- [ ] Code: three bank debits matching the demo's `p2p:UAH:4150.00` (USDT, day 110), `card:UAH:2600.00` and
      `bank:EUR:100.00` (Wise EUR card) rows, each inside its window, one with MCC 4829 or a "Binance"
      description; every holding keeps its end balance (S7-Q2); every row older than the 30-day window (S13-Q5).
- Check: `generate-demo-kiko.test.ts`, `build-demo-snapshot.test.ts`, `screenshot-seed.test.ts`,
  `transaction-form.demo-templates.test.ts` green; an approved screenshot that changes is a stop (S13-Q5).
- Estimate source: set 7's demo step (`kiko-binance-set7`); the estimator measures.

### step 7/8: spec alignment, reviews, retrospect, scribe

- [ ] Spec: the M rows gain their test titles (the real titles in the test files); the "One-to-one" bullet of
      "Matcher (set 13)" gains the augmenting-pass sentence and row M15 (S13-Q10); S13-Q1 ... S13-Q10 rulings into section 1 (from "Rulings"
      below); S12-Q17 closed (S13-Q2); section 9 Notes text names all three kinds. The S12-Q10 row is already
      CLOSED (plan commit). The rulings file already has the S13 block ("SET 13 PLAN RULINGS").
- [ ] `kiko:reviewer` G1 = steps 1/8-3/8. Top question: "can a debit leave spending that did not fund the
      exchange row, or a funding debit stay in spending, across ties, windows, currencies, hand rows and the
      account filter?"
- [ ] `kiko:reviewer` G2 = steps 4/8-6/8, then the whole branch at the tip BEFORE BATCH READY. No migration: no
      migration review.
- [ ] `kiko:retrospect` over both skill locations and `harness/kiko/agents/` (at least kiko-domain
      "Spending-exclusion pipeline" and "Exchange/Convert legs", kiko-architecture's pointer), then
      `kiko:scribe` commits; pointers, no copied lists; a `harness/kiko` change bumps the plugin version. The
      report names the drift-fix sha or "no drift found".
- Estimate source: no similar row.

### step 8/8: gates and BATCH READY

- [ ] Orchestrator: `KIKO_MUTATION_BASE=<set 13 base sha> make mutable`: quote the list and `mutable files: N
      (cap 30)`.
- [ ] Coordinator: `bash scripts/job-queue.sh gate <worktree> "crypto-exchanges-1.3-a task 13/15 deep" <base>
      <head>` (detached; agents await the exit code). TIMEOUT-HEAVY: the gate's own rerun is the verdict; never
      raise the timeout.
- [ ] Coordinator: `bash scripts/job-queue.sh verify <worktree> "crypto-exchanges-1.3-a task 13/15 verify"`
      once at the tip, tree clean, rerun until green. No agent runs `make verify`.
- [ ] BATCH READY names the base sha, the deep run id, the `make mutable` count, the reviewer verdicts, the
      scribe sha, the S13-Q rulings and the translator review.
- Estimate source: set 12's gate rows (`kiko-binance-set12`); the estimator measures.

## Review focus

1. Sort order: a hand or already excluded debit skipped instead of consumed (M12, M13 go wrong silently).
2. Window edges and sign: exclusive edges, `t` taken from the bank row, a card sell or fiat withdraw matched.
3. Input: the account-filtered rows fed instead of `ledgerWithCurrency` (M11); a crypto-account row on the bank
   side (M14).
4. Caption vs exclusion: the caption shown for a hand row, or the form running a different input than the
   screen.

## Rulings (S13-Q1 ... S13-Q9)

Source: `rulings.md` (main checkout, `memory/refs/binance-multicoin-sdd-2026-10-21/`), "SET 13 PLAN RULINGS".

| Id | Ruling | Who | Date |
|---|---|---|---|
| S13-Q1 | A: matcher only (R-Q14 as specced). The S12-Q10 P2P cover rule CLOSES as superseded, so one purchase is removed once; an outgoing USDT row counts once, in its own category; no step builds a cover rule | USER | 2026-10-26 |
| S13-Q2 | A (S12-Q17): a `p2p:` row stays out of statistics; `exchangeExcludedTransactionIds` unchanged | COORDINATOR | 2026-10-26 |
| S13-Q3 | A: a negative row with an exchange marker on a bank holding (a manual Exchange) takes part on the bank side; consumed, stays excluded, no caption (the exchange form shows no category) | COORDINATOR | 2026-10-26 |
| S13-Q4 | A: the caption hook reads the full ledger (same input and answer as the screen), only for a negative row on a non-crypto holding; a windowed query is backlog S13-B1 | COORDINATOR | 2026-10-26 |
| S13-Q5 | A: three demo debits (P2P, card, fiat deposit), end balances kept, older than 30 days; a change to an approved screenshot stops the step | COORDINATOR | 2026-10-26 |
| S13-Q6 | A: one help sentence in topic `'7'` (en + uk, translator) naming a bank payment that funded a P2P purchase, a card purchase or an exchange deposit | COORDINATOR | 2026-10-26 |
| S13-Q7 | uk `transactions.matchedP2pPurchase` = «Зіставлено з купівлею через P2P» in the spec, the uk catalogue and the tests (step 4/8 changes the spec section 10 row with the catalogue key); on the user's uk review list at release step 6 | COORDINATOR (text); USER review at release step 6 | 2026-10-26 |
| S13-Q8 | A: the `BINANCE` priority reads the stored description, not `ruleDescriptionOf` | COORDINATOR | 2026-10-26 |
| S13-Q9 | Accept: a hand edit or a saved (outranked) rule on a matched debit makes it a hand row that counts as spending, no caption; no change | USER | 2026-10-26 |
| S13-Q10 | B: keep the greedy pass, then an augmenting-path pass inside each (fiat, amount) bucket that only adds pairs; every greedy-matched row stays matched; pinned by M15; G1 Minors C1, C2, C3, C5 (rename), O2 ride the fix round; spec sentence in step 7/8 | USER | 2026-10-26 |

Backlog S13-B1 ... S13-B3 (section 1): accepted by the coordinator, 2026-10-26.
