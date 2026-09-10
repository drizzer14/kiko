# Kiko live board

_Maintained by the PM session — single writer, verified against git + orca on every refresh. Coordinator: `pff-ios-d3`._
_Last refresh: 2026-09-10 17:56 UTC — Phase B3: **diagnosis done**, both tracks implementing. **bugfix** (`phase-b3-bugfix`): R1 = display miscount from overlapping crypto syncs (single-flight JOIN, no data dup); R4 = bond valued at cost not nominal. **design** (`phase-b3-design`): D0-D3. USER DECISION: bond = cost (card→bond stays flat). Rolling integrate → check:deep (base `e447a80`) → redeploy._

**Anchor:** `main` @ `e447a80` — Phase A + Phase B + Phase B2 merged, gated, deployed (source `75225f0`). Active work = **Phase B3** (Phase B2 on-device review round; 2 tracks off `e447a80`). The B2 deploy stands until B3 redeploys. **Not pushed.**

## Branches / worktrees

| Worktree | Branch @ head | Role / state |
|---|---|---|
| `main` | `main` @ `e447a80` | Coordinator + PM anchor; all phases through Phase B2 merged, deployed + docs preserved |
| `phase-b3-bugfix` | `phase-b3-bugfix` @ `e447a80` | **developer** — R1 (single-flight JOIN in `use-sync-all.ts`), R4 (bond valued at cost in `holding-value.ts`) |
| `phase-b3-design` | `phase-b3-design` @ `e447a80` | **designer** — D0 revert button shrink, D1 faint-tinted secondaries, D2 categories Delete=Remove+trash, D3 trend-filter HIG redesign |
| `phase-b3-diagnose` | `phase-b3-diagnose` @ `e447a80` | Debugger diagnosis **done** (`docs/debug/2026-09-10-phase-b3-diagnosis.md`); prune-eligible / preserve doc at round end |

_Phase B2 round fully closed (deployed source `75225f0`; docs preserved `e447a80`). **Phase B3** opened off `main` @ `e447a80` — 2 tracks (diagnose/bugs + design). The B2 deploy stands until B3 redeploys. Verified via git._

_Domain track integrated @ `3a1e155` (conflict-free, `holding-detail.screen.tsx` only; check:all exit 0; review CLEAN). Design track integrated @ `cffa23e` (conflict-free, `trend-filter-field/*` + `categories.screen.tsx`; check:all exit 0; nit fixed `fa3fd34`; 35 jest green). Bugfix track integrated @ `0d5ed8c` (review CLEAN — `failuresCount` guard KEPT; items 1/8/12/14). Forms track integrated @ `bba1ac7` (re-review CLEAR — B1/B2/N1 all fixed at `f485fa3`: invalid credential never written, no duplicate account, asterisk a11y-hidden, tests non-tautological; items 3/5/6). **All 4 wave-1 tracks integrated.** Wave-1 chain: domain `3a1e155` → design `cffa23e` → bugfix `0d5ed8c` → forms `bba1ac7`. **No phase-b2 track worktree/branch remains** (git-verified); only `phase-b2-plan` + `phase-b2-diagnose` aux worktrees left (prune-eligible). Not pushed._

_Wave 2 (item 13 button audit) integrated @ `75225f0` (approved; fix `6f71365`; conflict-free; check:all exit 0; 2142 tests green). `phase-b2-buttons` + `phase-b2-review-buttons` pruned + branches deleted (git-verified). **Phase B2 code-complete. The SINGLE end-of-round check:deep gate is RUNNING** (base `e33b181`; Stryker live — verified)._

_All worktrees off LOCAL `main` @ `e33b181` (Orca default `origin/main` is stale/unpushed). Branches also present: `harness/orca-terminal-script-rule` (unrelated). Verified via git._

**Wave 1 has ZERO cross-track shared files → no line-range partitioning this round.** Integration = ROLLING per track (check:all + prune each). After all four integrate → wave 2 (item13 compact-button audit off updated `main`) → ONE `check:deep` (KIKO_MUTATION_BASE=`e33b181`) → deploy.

## Phase A — consolidate → merge to `main`

| # | Task | Status | Waits on |
|---|---|---|---|
| A1 | Round-2 mutation gate on `2602b2a` | ✅ Done — mutation PASS (66.96% per lead stdout; ≥60 confirmed by harness pass-marker; 44 of 793 scope). osv for this run unconfirmed by the observer → covered definitively at A3 | — |
| A2 | Integrate binance-fix onto the shipping branch | ✅ Done — clean ff, head now `e9d6895` | A1 ✅ |
| A3 | Definitive final gate — full check:deep (mutation + osv), incremental | ✅ Done — GREEN (mutation 67.70% / 69.24% cov ≥60; osv exit 2 on only the 3 accepted advisories; head `e9d6895`) | A2 ✅ |
| A4 | **Merge `light-scheme-charts` → `main`** | ✅ Done — `main` @ `e88c13e` (merge commit; conflict-free ort; harness commits preserved; check:all exit 0; not pushed) | A3 ✅ |
| A5 | PM doc refresh (stale HANDOFF.md, memories, churn note) | ✅ Done — HANDOFF.md rewritten to current state; memory phase-a-merged-2026-09-10 written + 5 stale entries marked superseded; branch-name misnomer resolved by the merge | A4 ✅ |

Round-2 on-device review = ✅ done / LGTM (no longer a gate).

## Phase B — 10-item feedback round (fresh branch off `main`, after A4)

Plan written and staged. Execution blocked on A4.

| Task | Owner | Item | Status |
|---|---|---|---|
| 0.1 Icon-size token + full iOS HIG audit (foundation) | designer | 8 | ✅ Done — `theme.iconSizes` (1.25 ratio) + call-site migration + `docs/design/2026-09-10-ios-hig-audit.md`; @ `eaf91dd` |
| 0.2 Durable HIG awareness (designer agent + design-system skill) | designer | — | ✅ Done — `35920fc` |
| 1.1 Bond footer button label (contributions → term deposits only) | developer | 1 | ✅ Done — committed `c07ce23` |
| 1.2 Holding-card secondary main-currency value (holdings only) | developer | 4 | ✅ Done — committed `c07ce23` |
| 1.3 Bond purchase is NOT an expense (stem `облігац` in transfer-exclusion.ts) | developer | + | ✅ Done — committed `4401559`; domain track **in review** |
| 2.1 Delete button → red ghost (transaction-form, delete ONLY; trash icon, 6.2:1 on #000) | designer | 5 | ✅ Done — `35920fc` |
| 2.2 Icons on ghost buttons | designer | 6 | ✅ Done — folded into 2.1 / 2.3 (`35920fc`) |
| 2.3 Ghost buttons on settings category cards (+ H1) | designer | 7 | ✅ Done — `35920fc` |
| H3 Compact Button minHeight 44 + icon-only Button (HIG audit finding) | designer | — | ✅ Done — `35920fc` |
| 3.1 Calendar background transparent | designer | 2 | ✅ Done — `a907184` |
| 3.2 Extend glass to Home + ledger list rows (stored + computed rows) | designer | 10 | ✅ Done — `a907184` |
| 3.3 OptionPills centered + 44pt + accent-filled selected (trend filter + CurrencySwitch + LanguageSwitch; inner-scroll already correct) | developer + designer | 9 | ✅ Done — `a907184` |
| 4.1 Confirm syncable not editable (no code, evidence only) | developer | 3 | ⚪ Pending |
| F1 "Received" money input currency suffix | developer | + | ✅ Closed — dropped by user (behavior correct as-is); regression test kept (`f514a22`) |
| F2 From/To picker sort by Accounts-screen order (account then holding sortOrder) | developer | + | ✅ Done — `f514a22` |
| F3 Cross-form Save-disabled-until-required audit (contribution/transaction + sync credential fields) | developer | + | ✅ Done — `f514a22` |
| Research spike: simulator screenshot / visual-regression test feasibility | explorer | + | ✅ Done — doc `docs/research/2026-09-10-simulator-screenshot-tests.md`; implementation DEFERRED to Final Hardening |

Dependencies: 0.1 ✅ unblocks 2.1/2.2/2.3 + 3.3's hierarchy step; domain (1.x) + forms (Fx) are token-independent, parallel-safe. HIG finding L2 (Dynamic Type) = DEFERRED, out of round scope.

Cross-track shared-file watch (each track kept to its own lines for disjoint integration): `transaction-form.screen.tsx` — design 2.1 (delete button) + forms F1/F3; `holding-detail.screen.tsx` — domain 1.1 + design 3.2 (later). PM verifies line-disjointness at integration.

**Phase B integration = ROLLING:** each approved track merges to `main` (`--no-ff` + fast check:all), worktree pruned after; ONE `check:deep` gate runs on `main` AFTER all Phase B tracks are integrated, before the deploy (one mutation run, not per-track). Overlap order: domain ✅ → design (3.2 glass on holding-detail) → forms — each onto the updated `main`.

**Design track fix wave (in progress, on `phase-b-design`):**
- Finding 1: enforce Button icon-only requires `accessibilityLabel` in the type.
- Finding 3: replace inline `size=18` in `option-pills.component.tsx` with the token.
- Finding 4: prove/adjust the category-card delete contrast on translucent glass.
- Finding 2 (over-glassing scroll cost) → not a code fix; moved to device-verify below.

**Device-confirm (post-Phase-B deploy):**
- Categories set-default star alignment — the shared compact ghost button uses `alignSelf: flex-start`; confirm the star reads centered in the card header row (it top-aligns if the identity field is taller).
- Ledger rows: computed + stored rows are BOTH glass cards — check visual consistency.
- List rows moved from bordered `radii.sm` to `md` glass cards — a visual density change, eyeball it.
- Over-glassing scroll cost (review finding 2) — check Home + ledger list scroll for jank from the extended glass rows.
- Item 9a: trend-filter selected-row `surfaceHigh` strength — confirm the selected state reads distinctly.
- Item 10: category ghost-delete button — the "already ghost in code" claim was a stale build; confirm on device.
- Item 11: default-category star padding + the disabled "Delete" button — confirm alignment and disabled state.

HIG-pass backlog (deferred): sub-44pt manual trend-filter row tap target.

Phase B deployed + launched on device F35979A3; on-device review DONE — user returned 10 items → **Phase B2** below.

## Phase B2 — 13-item on-device feedback round (fresh branch off `main` @ `e33b181`)

Active items: 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14. Item 7 dropped (transient stale data); item 14 = guarded stale-holding cleanup (the likely real cause of the old item-7 discrepancy).

Diagnosis done (`docs/debug/2026-09-10-phase-b2-diagnosis.md`). Plan complete: `docs/superpowers/plans/2026-09-10-phase-b2-fix-round.md`. **Wave 1 DISPATCHED** — 4 track worktrees (bugfix, domain, forms, design), all off local `main` @ `e33b181`, zero cross-track shared files. See the worktree table above for track → item mapping.

**Resolved product decisions:**
- Item 12: label = `'BTC'`; backfill existing empty crypto descriptions on re-sync.
- Item 5: create-then-connect (Option A).
- Item 8: day-granular local-day bond boundary — set bond `purchaseDate` to the debit day.
- Item 10: already ghost in code (stale build) — deploy verifies.
- Item 7: dropped (transient stale data).

**Waves:** Wave 1 = the 4 tracks below → each integrates ROLLING (check:all + prune). Wave 2 (after all four) = item 13 app-wide compact-button audit off the updated `main`. Then ONE `check:deep` (KIKO_MUTATION_BASE=`e33b181`) → deploy.

| Group | # | Item | Owner | Status |
|---|---|---|---|---|
| **P0 regression** (blocks review) | 1 | All entity icons empty in cards AND picker — likely a Phase B regression (iconSizes token migration or SymbolIcon change) | developer | ✅ Integrated (`0d5ed8c`) |
| ~~Correctness bug~~ | ~~7~~ | ~~Monobank TOTAL ~120 UAH above statement~~ — **DROPPED**: user re-synced, total now matches; the +120 was transient stale data, not a bug | — | ⚫ Dropped |
| Correctness bug | 8 | Net worth chart dips today from a card→bonds transfer (day-granular local-day bond boundary: set bond `purchaseDate` to the debit day) | developer | ✅ Integrated (`0d5ed8c`) |
| Domain | 2 | Disallow manual transactions into syncable assets AND bonds | developer | ✅ Integrated (`3a1e155`) |
| Domain | 4 | Main-currency values on the holding DETAIL screen (Phase B added them to cards only) | developer | ✅ Integrated (`3a1e155`) |
| Forms | 3 | Red asterisk on required fields | developer | ✅ Integrated (`bba1ac7`) |
| Forms | 5 | Sync credential fields in the bank/crypto account-creation form (create-then-connect / Option A; reuses `Button size="compact"`; 2 blocking findings fixed at `f485fa3`) | developer | ✅ Integrated (`bba1ac7`) |
| Forms | 6 | Open the date-range calendar at the END date | developer | ✅ Integrated (`bba1ac7`) |
| Forms | 9b | Disable the trend Save button when nothing new is selected | designer | ✅ Integrated (`cffa23e`) |
| Design | 9a | Fix trend-filter visual hierarchy (labels + selected state read like the Save button) | designer | ✅ Integrated (`cffa23e`); device-confirm selected-row surfaceHigh strength |
| Design | 10 | Remove-category button still not a ghost button (already ghost in code — stale build; deploy verifies) | designer | ✅ Integrated (`cffa23e`); device-confirm ghost-delete |
| Design | 11 | Default category's star has different padding than the set-default star; also show a **disabled** "Delete" button on the default category | designer | ✅ Integrated (`cffa23e`); device-confirm star padding + disabled delete |
| Domain/Forms bug | 12 | Changing a transaction's category FROM the crypto holding screen does not show the category-suggestion modal (label = `'BTC'`; backfill existing empty crypto descriptions on re-sync) | developer | ✅ Integrated (`0d5ed8c`) |
| Design | 13 | App-wide compact-button audit: switch lower-emphasis/inline/secondary actions to `size="compact"` (fullWidth=false, secondary/ghost); keep primary CTAs + full-width submits at "regular" (fix `6f71365` — add-category-row now matches the sheet-row pattern; 2142 tests green) | designer | ✅ Integrated (`75225f0`) |
| Bugfix | 14 | Guarded stale-holding cleanup in Monobank sync: `upsertAllHoldings` (`sync.ts:319-372`) never closes a holding the API stops returning, so a closed card/deleted jar lingers in the total (likely cause of the old item-7 +120). On a FULL successful sync, close holdings absent from the snapshot; guarded so a partial/failed/empty response never closes a live holding (defensive `failuresCount` guard KEPT per review) | developer | ✅ Integrated (`0d5ed8c`) |

## Phase B3 — Phase B2 on-device review round (2 tracks off `main` @ `e447a80`)

Opened from the Phase B2 on-device review. Two tracks run in parallel; the prior Phase B2 deploy (`75225f0`) stands until B3 redeploys. Integration = rolling per track (check:all + prune), then ONE check:deep (base `e447a80`), then redeploy. Diagnosis done (`docs/debug/2026-09-10-phase-b3-diagnosis.md`, in the `phase-b3-diagnose` worktree).

**USER DECISION:** a held bond is valued at **COST**, not nominal (so a card→bond move stays flat); the maturity redemption still realizes nominal. User confirmed the bond shows its value (not 0), ruling out a missing-credit bug.

**BUGS** — `phase-b3-bugfix` (developer), root causes found:

| # | Item | Owner | Status |
|---|---|---|---|
| R1 | Pull-to-refresh sync "total holdings" count GROWS each refresh (~+2). Root cause: a **display miscount from overlapping crypto syncs** — NO data duplication. Fix: single-flight JOIN over the pull fan-out (`use-sync-all.ts`) | developer | 🟡 In track (`phase-b3-bugfix`) |
| R4 | Net-worth chart STILL dips today on a card→bond move (Phase B2's day-granular fix did NOT resolve it). Fix: value a HELD bond at **cost** not nominal (`holding-value.ts` `bondBreakdown`); keep the maturity redemption realizing nominal | developer | 🟡 In track (`phase-b3-bugfix`) |

**DESIGN** — designer in `phase-b3-design`, tasks D0-D3:

| # | Item | Owner | Status |
|---|---|---|---|
| D0 | **REVERT** the item-13 audit's shrink of sheet/modal action-row secondaries — each matches its primary sibling (transaction-modal "Only for this"/"Cancel" full width; trend Clear = Save size; date-range Clear = Apply; add-category-row restored). The "make buttons look like before" directive | designer | 🟡 In track (`phase-b3-design`) |
| D1 | Small/secondary inline buttons = SMALLER + a FAINT TINTED (translucent) background, 44pt tap kept via `hitSlop`. The user's "ghost" = faint tinted background, NOT the transparent ghost variant | designer | 🟡 In track (`phase-b3-design`) |
| D2 | Categories Delete REUSES the contributions "Remove" (`destructiveTonal` + small) and add `icon="trash"` to BOTH (requested repeatedly, missed twice) | designer | 🟡 In track (`phase-b3-design`) |
| D3 | Trend filter **REDESIGN** grounded in Apple HIG (user: "almost unreadable") — the app's STANDARD selection vocabulary (not bespoke `surfaceHigh` rows); only the LIST scrolls (not the whole modal); disable BOTH Clear and Save when unchanged | designer | 🟡 In track (`phase-b3-design`) |

## Phase C — performance + bundle-size audit (fresh branch off `main`, after Phase B deploy)

Detailed planning closer to execution (downstream of Phase B). Runs as one of the three parallel Final-hardening audits.

| Task | Owner | Status |
|---|---|---|
| C1 Bundle-size audit: Hermes/Metro JS breakdown, heavy modules, dead code, unused/dup deps (knip+depcheck cross-check), image/font weight | ops + explorer | ⚪ Pending |
| C2 App/native-size audit: unused pods/native modules, Release settings (dead-code + symbol stripping), asset catalog, .ipa size breakdown | ops | ⚪ Pending |
| C3 Runtime perf audit: startup/TTI, re-render hotspots + memoization, list perf (FlatList / react-native-sortables), Reanimated worklets, op-sqlite/Drizzle query cost, image/memory | debugger + explorer | ⚪ Pending |
| C4 Fix pass: implement prioritized findings, measure before/after, TDD where testable | developer + ops | ⚪ Pending |
| C5 Verify + final deploy: re-measure bundle + key metrics, confirm the gain, deploy the lean build | ops + reviewer | ⚪ Pending |

## Final hardening (after Phase B deploy, before App Store publish)

Three independent read-only audits run IN PARALLEL, then consolidate → one fix pass → final deploy + App Store publish.

| Audit | Status |
|---|---|
| Bug-hunt (whole-app) | ⚪ Pending |
| Security analysis | ⚪ Pending |
| Phase C performance + bundle-size (C1–C5 above) | ⚪ Pending |
| Screenshot / visual-regression tests — Maestro `takeScreenshot` + pixel-diff (odiff/pixelmatch) + CI on a macOS runner (rec doc: `docs/research/2026-09-10-simulator-screenshot-tests.md`) | ⚪ Pending |
| Full-repo ponytail (over-engineering) review + codestyle pass (whole-repo; cut over-engineering, enforce code style) | ⚪ Pending |
| New kiko-code-style rule + repo-wide apply: "group non-component files into feature-based folders (e.g. a repo file + its test, related modules)" — skill/convention rule (NOT Biome-mechanizable); the codestyle pass reorganizes files (structural refactor — needs its own plan at hardening) | ⚪ Pending |

Then: consolidate ranked findings → fix → **final deploy + App Store publish**.

## Waiting on

**Phase B3 running** (from the B2 on-device review): bugs (R1, R4) + design (D0-D3) → rolling integrate each → ONE check:deep (base `e447a80`) → redeploy + device review → Final hardening (bug-hunt · security · Phase C, parallel) → consolidate + fix → **final deploy + App Store publish**. Nothing waits on the user right now (B3 diagnosis + design in progress). (bug-hunt · security · Phase C, parallel) → consolidate + fix → **final deploy + App Store publish**. Nothing waits on the user right now (wave 1 in progress).
