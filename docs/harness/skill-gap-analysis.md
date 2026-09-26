# Skill gap analysis — 2026-09-23

Scope: the 9 project skills in `.claude/skills/`, the 5 plugin skills in
`harness/kiko/skills/`, and the 12 agents in `harness/kiko/agents/`, checked
against `main` at `58fc479` (build 25). Upcoming work was read from
`feat/assets-debts` at `d13d5b8` with `git show` / `git diff` only.

Method: `kiko:retrospect` checked every concrete citation in both skill
locations and the agent files. `kiko:explorer` mapped each `src/` area to a
skill. The coordinator of this track re-verified every HIGH item with grep
before it went into this file. One explorer claim was wrong and is dropped:
`kiko-translator` DOES cover plurals (`.claude/skills/kiko-translator/SKILL.md:42-54`).

This track is analysis only. No skill, agent, code, or harness file changed.

## 1. Ranked findings

Impact: H = an agent that follows the skill writes wrong code or makes a wrong
release decision; M = an agent loses time or misses a rule; L = cosmetic or
cost only. Effort: S < 1 h, M = 1–3 h, L = more than 3 h.

| # | Type | Gap | Evidence | Impact | Proposed fix | Owner | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Drift | `kiko-design-system` still teaches content cards on `GlassSurface` with `tint`/`transparent`/`material` variants and an `entityCardBackground`/`entityTintBackground` color pipeline. Cards now use the solid `Card` component; glass is nav-layer only. The two functions do not exist (only stale comments name them). `Card` has NO entry in the component set or the description. | `.claude/skills/kiko-design-system/SKILL.md:291` (GlassSurface bullet), `:605-658` (Entity color and tint), `:627`, `:639`; `.claude/skills/kiko-charts/SKILL.md:113,276`; reality `src/design-system/components/card/card.component.tsx:8-16`; `<GlassSurface` is used only in `add-transaction-fab`, `bottom-sheet`, `use-keyboard-done-accessory`; stale comments `src/design-system/entity-tint.ts:17,51,62` | H | Rewrite the GlassSurface bullet as nav-layer only; add a `Card` entry; rewrite "Entity color and tint" to `resolveEntityColor` → `EntityIconTile` only; fix the 2 kiko-charts lines; add `Card` to the description. Fix the stale `entity-tint.ts` comments in code. | scribe (skills), developer (comments) | M |
| 2 | Drift | `kiko-architecture` sync sections target `settings.lastSyncAt` / `lastFullSyncAt` / `failedSyncMonobankIds`. These columns are SUPERSEDED; the live state is the per-connection `syncState` table. | `.claude/skills/kiko-architecture/SKILL.md:286,309,359,368,381,442,598`; reality `src/db/schema.ts:317-338` (`syncState`), `:212-219,249-270,300-312` ("SUPERSEDED"), `src/monobank/sync/sync.ts:104-114`, `src/sync/use-auto-sync/use-auto-sync.ts:103-107` | H | Rewrite the cursor/marker text to `syncStateRepo.getQuery(accountId)`; keep one line of history about the old `settings` columns. | scribe | M |
| 3 | Drift | `kiko-architecture` says the SQLCipher migration is "flag-gated off by default". Both flags are ON and must stay on. This also reads like a 5.6 hidden-feature flag. | `.claude/skills/kiko-architecture/SKILL.md:607-611`; `src/db/db-config.ts:18` (`DB_ENCRYPTION_ENABLED = true`), `:39` (`APP_LOCK_ENABLED = true`) | H | State "always on in every build; the constants exist only as a kill-switch record". Remove the rollout wording. | scribe | S |
| 4 | Drift | `kiko:release` "running submission log" stops at build 7 and says the pbxproj is at `1.1.0 / 7`, "Next submission — PENDING". Reality is 1.0.0 build 25, submitted. | `harness/kiko/skills/release/SKILL.md:59-105`, `:96-97`; `ios/Kiko.xcodeproj/project.pbxproj:289,325` (`CURRENT_PROJECT_VERSION = 25`) | H | Move the submission log out of the skill into HANDOFF or a dated doc. Keep only the durable procedure in the skill. A log in a skill drifts every build. | scribe | S |
| 5 | Drift | `kiko-design-system` names `CurrencySwitch` as a shared component (also in its trigger description). No such component exists. The base-currency control is a `CurrencyField`. | `.claude/skills/kiko-design-system/SKILL.md:3,545,548-568`; `ls src/design-system/components/` has no `currency-switch`; `settings.screen.tsx:214-223` | H | Remove the entry and the description token; move the `OptionPills` grid note (`:554-555`) to point at `LanguageSwitch` only. | scribe | S |
| 6 | Coverage | `data-transfer` (encrypted `.kiko` export/import, snapshot, secrets restore, hand-rolled UTF-8/base64) has no owning skill. Only one line names `src/data-transfer/crypto/`. The assets-debts plan changes it (N7: every new table must join `DataSnapshot`). | `.claude/skills/kiko-compliance/SKILL.md:90` (only mention); `src/data-transfer/` (12 files); invariant "old `.kiko` restores with `?? []`" lives only on the branch (`restore-snapshot.ts`); plan `docs/plans/shares-property-metals-debts.md:76` | H | Add a "Data transfer" section to `kiko-architecture` (or a new `kiko-data-transfer` skill): every table in `DataSnapshot`, every Keychain secret in `payload.d.ts`, legacy-file restore rule, no `TextDecoder` under Hermes. Mechanize the "every table" rule (#15). | scribe | M |
| 7 | Coverage | `statement-import` mechanics (format registry, parser, 7 formats, windows-1251 decode, detect → `importParsedStatement`) have no skill. The branch adds a large column-mapping section to `kiko-architecture`, which is already 861 lines. | `src/statement-import/` (28 files); only `.claude/skills/kiko-domain/SKILL.md:38,157` mention it; branch adds 58 lines at `kiko-architecture` "Statement import — column mapping" | M | Create `kiko-statement-import` skill: registry, format contract, encodings, dedup, column mapping, saved mappings. Move the branch section into it. Trigger: `src/statement-import/**`, `src/screens/statement-import`, `src/screens/column-mapping`. | scribe | M |
| 8 | Coverage | Rates and price pipeline (NBU / Monobank / CoinGecko providers, `fiat-rate-seed`, history backfill, `rate-history-repo`) is covered by one line in each of two skills. The branch adds `price_points`, `PriceBook`, NBU metals, EODHD. | `.claude/skills/kiko-domain/SKILL.md:379`, `.claude/skills/kiko-architecture/SKILL.md:834-861` ("Price data"); `src/rates/` (32 files); plan tasks T11-T12, T19, T37-T41 | H (for upcoming work) | Create `kiko-pricing` skill: the rate fallback chain, seed, history, `price_points`, carry-forward lookup, instrument namespaces, refresh throttles, quota guard. Move the branch's `kiko-domain` "Price series" section and the `kiko-architecture` price paragraph into it. | scribe | M |
| 9 | Agent fit | `planner` and `developer` do not load `kiko-compliance`. Only `reviewer` does. Guideline 5.6 rejected the app twice; a plan that adds a flag or a network host is only caught at review. | `harness/kiko/agents/planner.md` (reads architecture, code-style, design-system, domain only); `harness/kiko/agents/developer.md` skill list; `harness/kiko/agents/reviewer.md` item 4 | M | Add `kiko-compliance` to the planner's required skills and to the developer's "applies when" list (new host, permission, flag, credential). | scribe | S |
| 10 | Agent fit | No role can do web research or a live API probe. No agent has `WebSearch`/`WebFetch`. The shares research track and the plan's `[VERIFY LIVE]` probes (NBU metals, EODHD `/api/user`) can only run in an orchestrator session, outside the role agents. I did not check which session ran them. | `harness/kiko/agents/*.md` `tools:` lines; HANDOFF (main checkout) "research" 9 times, research track 2026-09-23; plan `:77` (N8), `:293` (T19 live probe) | M | Add a read-only `researcher` agent (sonnet, `WebSearch`, `WebFetch`, `Read`, `Bash` for `curl` probes; writes nothing) or add web tools to `planner`. The agent records each probe result in the test file header, as T19 asks. | scribe (agent), user decision | S |
| 11 | Agent fit | Device verification recurs every release (device-feedback rounds 1-6, "device test" in HANDOFF, plan T9/T44 tables), but no skill has a device test checklist. Each round rebuilds the list by hand. | memory `refs/device-feedback-round-{1..6}.md`; plan `docs/plans/shares-property-metals-debts.md:195,488-509`; `harness/kiko/skills/ops/SKILL.md:57` has deploy steps only | M | Add a "Device verification checklist" section to `kiko:ops` (or a small `kiko-device-test` skill): the standing regression list (lock, sync, import, export/import round trip, net worth, uk locale), network/TLS checks from memory note `device-verify-before-build-network-behavior`, Release build only for worklet/Hermes issues. | scribe | M |
| 12 | Trigger | `kiko-architecture` description names only storage, Monobank sync, and Keychain token. It does not fire for Binance/crypto sync, rates/price data, spending exclusion, or statement import, which it also documents (lines 651-861). | `.claude/skills/kiko-architecture/SKILL.md:3` vs `:651`, `:676`, `:834` | M | Add "Binance/crypto sync, rates/price refresh, spending exclusion" to the description, or split per #7 and #8 so each part has its own trigger. | scribe | S |
| 13 | Duplication | Plugin skill `design-system` (11 lines) overlaps `kiko-design-system` (734 lines). Its "single theme module" rule is generic, and its description fires on the same work. Two skills for one topic split the trigger. | `harness/kiko/skills/design-system/SKILL.md:1-11`; `.claude/skills/kiko-design-system/SKILL.md:3` | L | Replace the body with one pointer to `kiko-design-system` plus the designer/developer ownership line, or delete it and point `designer.md` at `kiko-design-system`. | scribe | S |
| 14 | Mechanization | A design-system component imports from `screens/`. The layer rule is not enforced; the codegraph also shows `design-system -> screens(1)`. | `src/design-system/components/currency-field/currency-field.component.tsx:18` (`../../../screens/forms/field-trigger`); memory codegraph section 2 | M | Move `FieldTrigger` into `src/design-system/components/`. Then add a Semgrep rule (or Biome `noRestrictedImports` if its pattern form fits): nothing under `src/design-system/` or a domain folder imports `src/screens/**`. | developer, then developer + kiko-linter rule | S |
| 15 | Mechanization | "Every DB table is in the export snapshot" and "every Keychain secret is in the credential export" are prose rules only (plan N7). A new table that misses the snapshot loses user data on restore, silently. | plan `:76`; `src/data-transfer/snapshot/data-snapshot.d.ts`; `src/db/schema.ts` | H | Add a Jest invariant: the set of `sqliteTable` exports in `schema.ts` equals the `DataSnapshot` keys (plus a documented exclusion list). | qa | S |
| 16 | Mechanization | Banned or crash-prone patterns that are prose only: `useAnimatedKeyboard()` (banned), `TextDecoder`/`TextEncoder` (broken on Hermes), a plain function inside a worklet without `'worklet'` (listed as a candidate, not enforced), import order (reviewer is the only check). | `.claude/skills/kiko-gestures/SKILL.md:42-79`; `src/data-transfer/utf8/utf8.ts:3-4`; `docs/harness/review-to-biome-inventory.md:62,69` ("not yet enforced") | M | Add 2 Semgrep ERROR rules (`useAnimatedKeyboard`, `new TextDecoder`/`TextEncoder` under `src/`) with fixtures. Then work down the "not yet enforced" rows of the inventory. | developer (kiko-linter) | S each |
| 17 | Coverage | The `uk` catalogue rules "use ’ (U+2019) for the apostrophe in a JS string" and "the app name is Кіко in Cyrillic" live only in memory, not in `kiko-translator`. | memory `kiko-ukrainian-name-cyrillic.md`; `grep -n "2019\|Кіко\|apostroph" .claude/skills/kiko-translator/SKILL.md` → no hits | M | Add both rules to `kiko-translator`. Add a Jest check on `uk.ts`: no ASCII `'` inside a Ukrainian word, no Latin "Kiko". | scribe, qa | S |
| 18 | Coverage | Bank provider registry rule ("`syncJobsFor` and account-detail never hardcode a provider list; a new provider is one registry entry") is a code comment only. Brokers (plan T35) reuse the catalog pattern. | `src/bank-sync/registry/registry.ts:28-41`; `.claude/skills/kiko-domain/SKILL.md:40` (one passing mention) | M | Add a "Bank catalog and provider registry" section to `kiko-domain`, then extend it for `brokerCatalog` and `sellsMetals` when T17/T35 land. | scribe | S |
| 19 | Coverage | Native iOS code (`AppDelegate.swift`, `SceneDelegate.swift`, UIScene lifecycle) and its crash lessons (iOS 27 scene manifest, `AppDelegate.window`, `NSFaceIDUsageDescription` for biometric Keychain) have no skill; they live in memory only. | `ios/Kiko/SceneDelegate.swift`, `ios/Kiko/AppDelegate.swift`; memory `ios27-crash-uiscene-lifecycle-gap.md`, `scene-lifecycle-appdelegate-window-crash.md`, `biometric-keychain-needs-nsfaceidusagedescription.md` | M | Add a short "Native iOS shell" section to `kiko-architecture`, with pointers to the memory lessons. | scribe | S |
| 20 | Drift | Dangling required-reading pointer: `docs/superpowers/plans/2026-09-19-screenshot-purge-e2e-only-v2.md` does not exist. | `.claude/skills/kiko-architecture/SKILL.md:59-60`; `ls docs/superpowers/plans/` | M | Point at `docs/harness/screenshots-check.md` or `docs/superpowers/plans/2026-09-15-strip-screenshot-subsystem-5.6-fix.md`, whichever holds the AC-BUNDLE-GREP step; or inline the grep list. | scribe | S |
| 21 | Dead rule | The widget was removed (`bba473f`), but 2 Semgrep ERROR rules and their fixtures still guard widget/App Group Swift code, and the entitlement still declares an App Group. I did not verify whether anything still needs the App Group. | `rules/semgrep-mobile.yml:67` (`kiko-widget-money-view-needs-privacysensitive`), `:93` (`kiko-appgroup-write-needs-protection`); `rules/fixtures/kiko-widget-*`, `kiko-appgroup-*`; `ios/Kiko/Kiko.entitlements` | L | Keep the rules only if a widget is planned; else remove them with a note in `documented-exceptions.md`. Ask the auditor to check whether the App Group entitlement is still used. | developer (kiko-linter), auditor | S |
| 22 | Duplication | The spending-exclusion pointer (3 modules in `src/statistics/`) is restated in two skills. | `.claude/skills/kiko-architecture/SKILL.md:651-675`; `.claude/skills/kiko-domain/SKILL.md:279-284` ("see `kiko-architecture` for the same pointer") | L | Keep it in `kiko-domain` only; leave a one-line cross-reference in `kiko-architecture`. | scribe | S |
| 23 | Drift | Worked example cites `fetchBTCPrice` / `loadBTC`; neither exists now (`RefreshDeps` has `fetchCryptoPrices`). | `.claude/skills/kiko-code-style/SKILL.md:342-344`; `src/rates/rates-refresh/rates-refresh.ts:30-39` | L | Replace with a live example or state it as history. | scribe | S |
| 24 | Drift | `qa` agent cites `src/holdings/holdings.repo.test.ts`; the file is `src/holdings/repo/holdings.repo.test.ts`. | `harness/kiko/agents/qa.md` (repository-test bullet) | L | Fix the path. | scribe | S |
| 25 | Cost | The two biggest skills load in full on most work: `kiko-architecture` 861 lines, `kiko-design-system` 734, `kiko-code-style` 558. `kiko-code-style` fires on "any .ts or .tsx". The branch adds about 200 more lines. | `wc -l .claude/skills/*/SKILL.md` | L | The splits in #7 and #8 cut about 250 lines from `kiko-architecture`. Move narrative incident history (for example the 5.6 screenshot saga, `:12-70`) to `docs/`, and keep the rule plus a pointer. | scribe | M |

## Status (2026-09-23)

Resolved on this branch (`skill-gap-analysis`), shas from `git log --oneline`
on this branch:

- #1, #2, #3, #4, #5, #9, #20, #22, #23, #24 — `097b07d`, `aedb1b3`,
  `6cb5b00`, `f6a543b`.
- #14, #16, #21 — `ad4d713`, `0f8428a`, `67ab4d0`, `4e66dd7`.
- #15 — `e8362d1`.
- #17 (mechanized test) — `e7e8985`; #17 (skill content, uk apostrophe/app
  name rules + the deploy-review workflow rule) — `0ed3d9d`.
- #6 (data-transfer coverage) — `36b8d64`; #19 (native iOS shell) — `4714c94`.
- #18 (bank catalog and provider registry) — `493c71f`.
- #10 (researcher agent) — `16323ff`.
- #11 (device verification checklist) — `a6efac2`.
- Codegraph section 4 (navigation-reachability grep in `kiko:release`) —
  `6166cb8`.
- #21's App-Group entitlement follow-up (documented-exceptions entry) —
  `fc82467`.

Open:

- #7 (`kiko-statement-import` skill), #8 (`kiko-pricing` skill), #12
  (`kiko-architecture` trigger split), #25 (narrative-history trim) — owned
  by the `feat/assets-debts` track; out of scope here per this track's
  cross-track rule (do not touch statement-import, rates/price, or create
  those two skills).
- #13 (plugin `design-system` skill vs `kiko-design-system` duplication) —
  not in scope for this track.

Standing drift rule already landed: `a932fef` (harness), `bef3f45`
(`CLAUDE.md`, owned by the coordinator, not this track).

## 2. Coverage map — `src/` area to skill

File count = non-test `.ts`/`.tsx` files. Depth: DEEP = rules and invariants
written down; SHALLOW = named in 1-2 lines; NONE = no skill.

| `src/` area | Files | Owning skill | Depth |
|---|---|---|---|
| screens | 167 | kiko-design-system (composition), kiko-charts (`statistics/`), others per feature | mixed |
| design-system | 112 | kiko-design-system | DEEP, but drifted (#1, #5) |
| rates | 32 | kiko-domain `:379`, kiko-architecture `:834` | SHALLOW (#8) |
| statement-import | 28 | kiko-domain `:38,157` | SHALLOW (#7) |
| holdings | 26 | kiko-domain | DEEP |
| statistics | 23 | kiko-domain, kiko-charts, kiko-architecture `:651` | DEEP (duplicated, #22) |
| monobank | 19 | kiko-architecture `:162-606` | DEEP, but drifted (#2) |
| crypto-sync | 18 | kiko-architecture `:676-833` | DEEP (Binance); BTC wallet provider NONE |
| transactions | 14 | kiko-domain | DEEP (schema); row formatting SHALLOW |
| sync | 12 | kiko-architecture (indirect) | SHALLOW |
| i18n | 12 | kiko-translator | DEEP; uk apostrophe + Кіко missing (#17) |
| db | 12 | kiko-architecture `:71-161`, `:607` | DEEP, but drifted (#3) |
| data-transfer | 12 | kiko-compliance `:90` (one line) | NONE (#6) |
| currency | 10 | kiko-domain | DEEP |
| navigation | 9 | kiko-code-style (naming), kiko-design-system (tab chrome) | SHALLOW |
| calendar | 9 | none | NONE (low risk: UI widget) |
| bank-sync | 8 | kiko-domain `:40` | SHALLOW (#18) |
| categories | 6 | kiko-domain | DEEP |
| migration | 5 | kiko-architecture `:88-101` | DEEP |
| test-support | 5 | qa agent | agent-level (acceptable) |
| dates | 4 | none | NONE (low risk) |
| auth | 4 | kiko-domain `:312`, kiko-design-system `:596` | DEEP |
| sync-state | 1 | none (the skill still points at `settings`, #2) | NONE |
| settings | 1 | kiko-architecture (per column) | SHALLOW |
| accounts | 1 | kiko-domain | SHALLOW |
| `ios/Kiko` (native) | 2 Swift | none | NONE (#19) |
| `.maestro/`, `e2e/` | 1 flow + screenshot kit | qa agent; kiko-compliance `:25`, `docs/harness/screenshots-check.md` | SHALLOW |

The iOS widget does not exist anymore; see #21.

## 3. Upcoming work — `feat/assets-debts`

The branch already updates skills for P0 and P1 (commits `0b61130`,
`61841ed`): `kiko-architecture` +78 lines (price_points, column mapping),
`kiko-domain` +97 (price series, priced holdings, bankId), and
`kiko-design-system` +24 (`SelectableRow`, select-field family). The plan
schedules scribe edits for later tasks in `kiko-domain` (T17, T27, T35),
`kiko-charts` (T27), `kiko-linter` + `kiko-compliance` (T34, T42).

| Skill | Change needed | Plan task |
|---|---|---|
| NEW `kiko-pricing` | Home for rates + `price_points` + `PriceBook` + NBU metals + EODHD client, quota guard, once-per-day refresh, backfill. Take the branch text out of `kiko-domain` and `kiko-architecture`. | T11-T12, T19, T38-T41 |
| NEW `kiko-statement-import` | Home for the format registry and the column-mapping importer. Take the branch section out of `kiko-architecture`. | T1-T8, T22 |
| kiko-domain | Account kinds `property`/`metals`/`debt`/`broker`; holding types `property_item`/`metal`/`loan`/`share`; lots; ledgerless types; troy-ounce rule; net worth = assets − debt outstanding (a SEMANTIC change to the existing "Net worth" section); `bankId` as the catalog id per kind; metal allow-list as data. | T13, T17, T26-T27, T35 |
| kiko-charts | Pie excludes debts; the net-worth line can cross 0 (axis and area-fill rules for negative values). | T27 |
| kiko-design-system | "Debts" section on accounts screen; negative headline on home; gain/loss color through `MoneyText`. | T27, T36 |
| kiko-compliance | New host `eodhd.com` with pins; BYOK key; `bank.gov.ua` new paths; "no financial advice" wording for shares; brokers as complete manual entries (5.6). | T34, T37, T42 |
| kiko-linter | `plist.sh` detects `api_token` query credentials. | T34 |
| kiko-architecture | Data-transfer rules for `pricePoints`, `bondRegister`, EODHD key (see #6); keep it as the storage/sync skill only. | T11, T24, T38 |
| kiko-translator | New en/uk keys for 4 kinds; subtitles; Ukrainian finance terms (Майно, Борг, Брокер, Дорогоцінні метали). | T15-T41 |
| `kiko:ops` / device checklist | P0 and P5 device tests (#11). | T9, T44 |

Risk: the plan puts all new facts into the 2 largest skills. Create the 2 new
skills BEFORE P2 starts, so later scribe tasks write to the right place. Per
the memory note `harness-changes-need-track-merge-reload`, a skill created on `main` does not
reach the running `feat/assets-debts` track until that branch merges `main`
and the session reloads. Land the new skills ON `feat/assets-debts`, or merge
them in before T17.

## 4. Codegraph evaluation

The file `memory/refs/codegraph-2026-09-21.md` (main checkout, untracked,
96 lines) holds: (1) a navigation reachability map (which screens a reviewer
can reach, with no env/flag gate), (2) domain-to-domain import counts,
(3) 3 import cycles through barrels, (4) a note that madge orphans are false
positives and Knip is the real dead-code proof. It is from build 20. It does
not show `src/prices/`, `src/screens/column-mapping/`, or the new stacks on
the branch. No skill or agent points to it.

Value:
- Section 1 is the useful part. It is direct evidence for App Store review
  notes under Guideline 5.6, and the reviewer and release skills need it at
  each submission.
- Section 2 helps the explorer a little, but grep answers the same questions
  at low cost. It does not justify a check.
- The layer rule it exposes (`design-system -> screens`, #14) is better as an
  enforced rule than as a map that someone must read.
- Section 3 (cycles) is a real but low-priority structural fact.

Cost:
- `madge` is not a dependency. `npx madge@8` fetches an unpinned package
  from the network, which conflicts with the exact-pin and 7-day-age rules in
  `docs/harness/dependency-hygiene.md`. Adding it as a dev dependency needs
  user approval plus `knip`/`depcheck` entries.
- Madge cannot resolve the path aliases or the `App.tsx` entry point (43
  unresolved imports in the build-20 run), so its orphan list is noise.
- A script is about 1-2 h of developer time. The output is about 100 lines
  (about 2k tokens) per read.

Recommendation: do NOT add a codegraph check or a standing skill pointer.
Instead:
1. Mechanize the layer boundary (#14) with Semgrep. This catches the only
   actionable fact in section 2 at every edit.
2. Add a "Navigation reachability" step to `kiko:release` Part B: generate
   the screen list from `src/navigation/*-stack/*.stack.tsx` and the root navigator
   with a small zero-dependency script (grep the `Stack.Screen`/`Tab.Screen`
   names), and paste it into the App Store review notes. This keeps the 5.6
   evidence current per build without madge.
3. If the user later wants the cycle check, add `dependency-cruiser` (it can
   also enforce the layer rules) as one approved dev dependency instead of
   madge. Treat this as optional.
4. Mark the build-20 file as a historical record in memory. Do not cite it
   as current.

## 5. Recommended order

1. Fix the HIGH drift in one scribe pass: #1, #2, #3, #4, #5, #20 (plus the
   small drift #23, #24). These mislead agents today, on `main`. About 3 h.
2. Add `kiko-compliance` to planner and developer (#9). About 15 min.
3. Create `kiko-pricing` and `kiko-statement-import` (#7, #8, #12, #25) and
   land them on `feat/assets-debts` before task T17. About 3 h.
4. Add the data-transfer coverage and its Jest invariant (#6, #15) before
   T24/T38 add more tables and secrets.
5. Mechanize: layer boundary with the `FieldTrigger` move (#14),
   `useAnimatedKeyboard` and `TextDecoder` rules (#16), uk catalogue check (#17).
6. Agent fit: decide on a researcher agent (#10, user decision); add the
   device checklist (#11).
7. Low-priority cleanup: #13, #18, #19, #21, #22; the codegraph steps in
   section 4.
