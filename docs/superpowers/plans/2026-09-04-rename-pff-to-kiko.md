# Rename `pff`/`PFF` → `kiko`/`Kiko` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product and its agent harness from `pff`/`PFF` to `kiko`/`Kiko` project-wide (app source, iOS Xcode target, package/config, project skills, harness plugin, docs), preserving case in every replacement, WITHOUT changing the iOS bundle identifier, the on-device data/keychain identity, the repo folder name, or any Orca worktree/branch path.

**Architecture:** Deterministic, category-ordered rename executed with `git mv` for tracked renames (history preserved) and precise per-file content edits. The delicate CocoaPods/Xcode target rename is isolated into its own carefully-sequenced task that deintegrates Pods first, renames the app-target references, and re-runs `pod install`. Three classes of `pff` tokens are held immutable: the bundle id, on-device persistence identifiers, and git/worktree/repo path slugs.

**Tech Stack:** React Native (bare, iOS), CocoaPods, TypeScript, Jest, the local `pff` Claude Code plugin harness (Biome/jscpd/Knip/depcheck/Semgrep checks).

**Spec:** This plan is the spec (a mechanical rename with explicit scope decisions supplied in the task brief). No separate design doc.

**Worktree:** Operate ONLY in `/Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko` (branch `drizzer14/rename-pff-to-kiko`, base commit `3fb7e22`). Every path below is relative to that worktree root unless absolute. Never touch `/Users/drizzer14/Developer/Projects/pff-ios`.

---

## Global Constraints

Copied verbatim from the task brief — every task implicitly includes these:

- **Preserve case in every replacement:** `PFF`→`Kiko`, `pff`→`kiko`, `Pff`→`Kiko`. There is exactly one mixed-case form in the codebase, `Pff` (the `PffCalendar` identifiers), and it maps to `Kiko`.
- **KEEP the iOS bundle identifier `com.dmytro.pff` unchanged everywhere.** The on-device app keeps its identity and data.
- **KEEP the repo root directory named `pff-ios`.** Do NOT rename the repo folder or any Orca worktree path.
- **The display name `Кіко` (Cyrillic) is already correct** — no change (verified: `ios/PFF/Info.plist` `CFBundleDisplayName = Кіко`).
- **Standing harness rule:** fix the underlying issue; never weaken a check. Renamed rule ids/paths stay real and consistent.

## MUST-NOT-CHANGE token list (immutable proper nouns)

These `pff` substrings name things that are explicitly out of scope. They must survive every sweep verbatim. Any replacement script MUST exclude them.

| Token | Where | Why it must not change |
|---|---|---|
| `com.dmytro.pff` | `ios/PFF.xcodeproj/project.pbxproj` (2 lines: `PRODUCT_BUNDLE_IDENTIFIER`), 3 docs | The bundle id; changing it makes the OS treat it as a different app and orphans on-device data. |
| `pff.db` | `src/db/client.ts:12` | The SQLite database filename. Renaming it orphans all existing on-device financial data (same data-preservation intent as the bundle id). **HAZARD — see Task 3.** |
| `pff.monobank.token` | `src/monobank/token.ts:3` | The iOS Keychain service key. Renaming it orphans the stored Monobank token; the user would have to re-authenticate. **HAZARD — see Task 3.** |
| `pff-ios` | many docs, `CLAUDE.md` | The repo directory name and the Orca workspace path segment `/orca/workspaces/pff-ios/`. Explicitly kept. |
| `drizzer14/pff-app-store`, `drizzer14/pff-consolidated`, `drizzer14/pff-ios`, `drizzer14/pff-redesign-phase-1`, `drizzer14/pff-redesign-review`, `drizzer14/pff-statistics`, `drizzer14/pff-ux-round` | docs | Real, already-created git branch names. Renaming the text makes the docs reference nonexistent branches. |
| Worktree slugs after `/orca/workspaces/pff-ios/`: `pff-app-store`, `pff-redesign-phase-1`, `pff-statistics`, `pff-ux-round` | docs | Real, already-created Orca worktree directories. |
| The subject mentions in THIS plan file (`2026-09-04-rename-pff-to-kiko.md`) | this file | The document is *about* the pff→kiko rename; its prose necessarily names `pff`. Documented exception. |
| `ios/build-attempt2.log` content (~3100 `pff`/`PFF` hits) | tracked build artifact | Do NOT hand-edit a 3100-line generated log. Task 1 removes the file instead (`git rm`). |

Everything else is in scope.

---

## Complete inventory

Verified via `git ls-files | grep -i pff` and case-sensitive `git grep -c 'PFF'` / `git grep -c 'pff'` (excluding `package-lock.json`). Counts are in-file occurrence counts at base commit `3fb7e22`.

### Category A — iOS Xcode project (Task 1)

Directory / bundle renames (`git mv`):
- `ios/PFF/` → `ios/Kiko/` (source group dir: `AppDelegate.swift`, `Info.plist`, `LaunchScreen.storyboard`, `PrivacyInfo.xcprivacy`, `Images.xcassets/`)
- `ios/PFF.xcodeproj/` → `ios/Kiko.xcodeproj/`
- `ios/PFF.xcodeproj/xcshareddata/xcschemes/PFF.xcscheme` → `.../Kiko.xcscheme`
- `ios/PFF.xcworkspace/` → `ios/Kiko.xcworkspace/`

In-file content edits:
- `ios/PFF.xcodeproj/project.pbxproj` — 40 `PFF` refs. Rename all EXCEPT the two `PRODUCT_BUNDLE_IDENTIFIER = com.dmytro.pff;` lines (267→ area: lines 279, 311). Note: the ~14 `Pods-PFF`/`libPods-PFF.a` refs are removed by `pod deintegrate` (Task 1 step 1), not hand-edited.
- `ios/PFF.xcodeproj/xcshareddata/xcschemes/PFF.xcscheme` — 12 refs (`BuildableName`, `BlueprintName`, `ReferencedContainer`, `PFFTests`).
- `ios/PFF.xcworkspace/contents.xcworkspacedata` — 1 ref (`group:PFF.xcodeproj`).
- `ios/PFF/AppDelegate.swift:27` — `withModuleName: "PFF"` (must equal `app.json` `name`).
- `ios/PFF/LaunchScreen.storyboard:19` — label `text="PFF"`.
- `ios/Podfile:25` — `target 'PFF' do`.
- No change: `ios/PFF/Info.plist` (`CFBundleName = $(PRODUCT_NAME)`, `CFBundleDisplayName = Кіко` — already correct), `ios/PFF/PrivacyInfo.xcprivacy`, `ios/PFF/Images.xcassets/*` (no `pff` inside; only the parent dir path moves), `ios/Podfile.lock` (contains NO `PFF` — verified; regenerated by `pod install` regardless), `ios/.xcode.env` (no `PFF`).
- Remove: `ios/build-attempt2.log` (`git rm`).
- Regenerated (untracked, `ios/Pods/**` is gitignored): `Pods-Kiko.*`, `Target Support Files/Pods-Kiko/`, `Pods.xcodeproj` — created by `pod install`.

### Category B — package & config (Task 2)

- `package.json:2` — `"name": "PFF"` → `"Kiko"` (1 `PFF`).
- `app.json:2-3` — `"name": "PFF"`, `"displayName": "PFF"` → `"Kiko"` (2 `PFF`). `name` is the AppRegistry root key (`index.js`) and MUST equal `AppDelegate.swift` `withModuleName`.
- `.npmrc:5` — `min-release-age-exclude[]=PFF` → `=Kiko` (1 `PFF`; first-party package name exemption).
- `jest.config.js:22,25` — comment refs `pff-calendar.day-cell-color.test.tsx` and `PFF hands it` (1 `PFF`, 1 `pff`).
- `scripts/checks/security.sh:23,25,26` — temp file `/tmp/pff-security-stderr.$$` → `/tmp/kiko-security-stderr.$$` (3 `pff`, cosmetic).
- `rules/semgrep-mobile.yml` — 11 rule ids `pff-*` → `kiko-*` (`pff-disabled-tls`, `-insecure-random-for-secrets`, `-secret-in-asyncstorage`, `-secret-in-db-or-log`, `-repo-no-class`, `-repo-satisfies-not-annotation`, `-money-column-integer-minor-units`, `-component-rest-props-named-props`, `-first-two-arg-not-curried`, `-no-handrolled-pipe-compose`, `-webview-injectedjs-dynamic`). Ids are internal to this file (verified: no `nosemgrep:` suppressions reference them anywhere in `src/`).
- `index.js` — no `pff`; reads `name` from `app.json` dynamically, no edit needed (verify only).

### Category C — app source (Task 3)

Calendar screen file renames (`git mv`):
- `src/screens/calendar/pff-calendar.props.d.ts` → `kiko-calendar.props.d.ts`
- `src/screens/calendar/pff-calendar.component.tsx` → `kiko-calendar.component.tsx`
- `src/screens/calendar/pff-calendar.component.test.tsx` → `kiko-calendar.component.test.tsx`
- `src/screens/calendar/pff-calendar.day-cell-color.test.tsx` → `kiko-calendar.day-cell-color.test.tsx`

In-file identifier + import + comment edits:
- `src/screens/calendar/index.ts:1` — `export { default } from './pff-calendar.component'` → `./kiko-calendar.component`.
- `kiko-calendar.props.d.ts:7` — type `PffCalendarProps` → `KikoCalendarProps`.
- `kiko-calendar.component.tsx:5,41,96` — import path `./pff-calendar.props` → `./kiko-calendar.props`; `PffCalendarProps` → `KikoCalendarProps`; `const PffCalendar` / `export default PffCalendar` → `KikoCalendar`.
- `kiko-calendar.component.test.tsx:3,8,10,19,28,47` — import path, `PffCalendar` identifier, `describe('PffCalendar')` → Kiko.
- `kiko-calendar.day-cell-color.test.tsx:5,14,15` — comment refs `PffCalendar` and `pff-calendar.component.tsx` → Kiko.
- Consumers of the default export (local alias only — the directory is imported via `index.ts`, so the filename change is invisible to them; only the local binding name is renamed for consistency):
  - `src/screens/forms/date-field/date-field.component.tsx:10,72` — `import PffCalendar from '../../calendar'` and JSX `<PffCalendar` → `KikoCalendar`.
  - `src/screens/home/date-range-field/date-range-field.component.tsx:11,24,134,210` — import, JSX, and 2 comment refs `PffCalendar` → `KikoCalendar`.
- Skill/doc path refs in comments (these must agree with Task 4 skill renames and Task 6 doc renames):
  - `src/design-system/components/bottom-sheet/bottom-sheet.component.tsx:27` — ``pff-design-system`` → ``kiko-design-system``.
  - `src/design-system/components/bottom-sheet/bottom-sheet.styles.ts:30,50` — ``pff-design-system`` → ``kiko-design-system``.
  - `src/design-system/theme.ts:4-5` — doc path `2026-08-30-pff-foundation-design.md` → `...-kiko-foundation-design.md` and skill path `.claude/skills/pff-design-system/SKILL.md` → `kiko-design-system`.
- **DO NOT CHANGE (hazards):** `src/db/client.ts:12` `name: 'pff.db'`; `src/monobank/token.ts:3` `'pff.monobank.token'`. See the MUST-NOT-CHANGE table and the Task 3 hazard note.

### Category D — project skills (Task 4)

Directory renames (`git mv`), all under `.claude/skills/`:
- `pff-architecture/` → `kiko-architecture/`
- `pff-charts/` → `kiko-charts/`
- `pff-code-style/` → `kiko-code-style/`
- `pff-design-system/` → `kiko-design-system/`
- `pff-domain/` → `kiko-domain/`
- `pff-gestures/` → `kiko-gestures/`

Each `SKILL.md` needs: `name:` frontmatter (`name: pff-architecture` → `kiko-architecture`, etc.), title `# PFF ...` → `# Kiko ...`, cross-references to sibling skills (``pff-domain``, ``pff-code-style``, ``pff-architecture``, ``pff-charts``, ``pff-gestures``, ``pff-design-system``), the `Source of truth:` doc paths (renamed in Task 6: `2026-08-30-pff-foundation-design.md` → `...-kiko-foundation-design.md`), and the harness skill path in `pff-design-system` (``harness/pff/skills/design-system/SKILL.md`` → ``harness/kiko/...``). Per-file occurrence counts: architecture 1 `PFF`/6 `pff`, charts 1/2, code-style 2/5, design-system 1/9, domain 1/4, gestures 1/1.

### Category E — harness / plugin (Task 5) — SELF-REFERENTIAL

Directory rename (`git mv`): `harness/pff/` → `harness/kiko/`.

Files whose content must stay mutually consistent after the move:
- `harness/.claude-plugin/marketplace.json` — `name: "pff-marketplace"` → `"kiko-marketplace"`, `owner.name "PFF"` → `"Kiko"`, plugin `name "pff"` → `"kiko"`, `source "./pff"` → `"./kiko"`, description `PFF` → `Kiko`.
- `harness/pff/.claude-plugin/plugin.json` → (after move) `harness/kiko/.claude-plugin/plugin.json` — `name "pff"` → `"kiko"`, description `PFF`, `author.name "PFF"` → `Kiko`.
- `harness/pff/hooks/hooks.json` — **NO content edit** (verified: uses `${CLAUDE_PROJECT_DIR}/scripts/checks/...`, contains zero `pff`); only the parent dir moves.
- `harness/pff/agents/*.md` (10 files) — content refs: `harness/pff/` → `harness/kiko/`, `pff:` plugin-namespace refs (e.g. `pff:reviewer`) → `kiko:`, `PFF`/`pff` prose. Per file with hits: designer 1`PFF`, developer 2`PFF`, planner 1`PFF`/2`pff`, qa 2`PFF`/1`pff`, reviewer 2`pff`, scribe 1`pff`. The agent `name:` frontmatter is the role name (`developer`, `reviewer`, …), NOT `pff-`prefixed — leave those; only the `pff:`/`PFF`/`pff` string refs change.
- `harness/pff/commands/ponytail-review.md` — path/prose refs.
- `harness/pff/skills/{design-system,harness-workflow,ops,retrospect}/SKILL.md` — content `PFF`/`pff` refs (design-system 1`PFF`/…, harness-workflow 1`PFF`, ops 1`PFF`). These skill dir names are NOT `pff-`prefixed (just `design-system`, etc.) — only content changes.
- `.claude/settings.json:3` — `"pff@pff-marketplace": true` → `"kiko@kiko-marketplace": true` (must equal marketplace `name` + plugin `name` from `marketplace.json`).
- `docs/harness/review-to-biome-inventory.md` — 1`PFF`/26`pff` (references `harness/pff/` paths and the `pff-*` semgrep rule ids from Task 2; must be updated to `harness/kiko/` and `kiko-*`).
- `CLAUDE.md` (worktree copy) — 4`PFF`/4`pff` (harness prose: `harness/pff/`, `pff` plugin, `min-release-age-exclude[]=PFF`, `harness/pff/commands/ponytail-review.md`). Update to `kiko`. Preserve the `com.dmytro.pff`/`pff-ios` immutables if present (none in the 8 hits — all are harness/package refs).

### Category F — docs (Task 6)

Doc filename renames (`git mv`), `pff` → `kiko` in the name, date prefix preserved:
- `docs/superpowers/plans/2026-08-30-pff-agent-plugin.md` → `...-kiko-agent-plugin.md`
- `docs/superpowers/plans/2026-08-30-pff-foundation.md` → `...-kiko-foundation.md`
- `docs/superpowers/plans/2026-08-30-pff-quality-harness.md` → `...-kiko-quality-harness.md`
- `docs/superpowers/plans/2026-08-30-pff-scaffold.md` → `...-kiko-scaffold.md`
- `docs/superpowers/plans/2026-08-31-pff-redesign-phase-1.md` … `-phase-5.md` → `...-kiko-redesign-phase-N.md` (5 files)
- `docs/superpowers/plans/2026-09-01-pff-redesign-feedback-round-1.md` → `...-kiko-redesign-feedback-round-1.md`
- `docs/superpowers/specs/2026-08-30-pff-foundation-design.md` → `...-kiko-foundation-design.md`
- `docs/superpowers/specs/2026-08-30-pff-scaffold-and-harness-design.md` → `...-kiko-scaffold-and-harness-design.md`
- `docs/superpowers/specs/2026-08-31-pff-redesign-design.md` → `...-kiko-redesign-design.md`

Doc content: many files carry `pff`/`PFF` prose (see counts in the appendix grep). Apply the case-preserving replacement with the MUST-NOT-CHANGE preserve-list (Task 6 gives the exact script). The 3 files containing `com.dmytro.pff` (`docs/research/2026-09-04-app-store-publishing.md`, `docs/superpowers/plans/2026-09-04-app-store-publishing.md`, `docs/superpowers/specs/2026-09-04-app-store-publishing-design.md`) and every `drizzer14/pff-*` / `/orca/workspaces/pff-ios/pff-*` / `pff-ios` reference must survive.

---

## Task 1: iOS Xcode target rename (delicate — do this first, in this exact order)

**Files:** all of Category A. **Requires:** a machine with CocoaPods + Xcode CLI (`ops`/`developer` role).

**Interfaces:**
- Produces: an Xcode project/target/scheme named `Kiko`, product `Kiko.app`, source dir `ios/Kiko/`, with `PRODUCT_BUNDLE_IDENTIFIER` still `com.dmytro.pff`. Task 2's `app.json` `name` and this task's `AppDelegate.swift` `withModuleName` must both read `Kiko`.

**Why order matters:** `pod deintegrate` reads the *current* pbxproj to strip every `[CP]` build phase, `libPods-PFF.a` link, and `Pods-PFF.*.xcconfig` baseConfiguration. Doing it BEFORE the rename means the hand-edit of `project.pbxproj` only touches app-target references (no `Pods-PFF` strings survive to edit), and the subsequent `pod install` cleanly regenerates `Pods-Kiko` integration for the renamed target.

- [ ] **Step 1: Deintegrate CocoaPods (while target is still `PFF`)**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
pod deintegrate
```

Expected: "Deintegrating `PFF.xcodeproj`" and removal of Pods integration. This mutates `project.pbxproj` (removes `Pods-PFF` refs) but leaves it uncommitted — that is fine.

- [ ] **Step 2: Remove the stale tracked build log**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git rm ios/build-attempt2.log
```

(Stale Release-build log full of `PFF`; `ios/build/` is gitignored and this file slipped in outside it. Removing it also clears ~3100 residual hits. If the user objects, the alternative is a `.gitleaks`-style path allowlist entry — but removal is recommended.)

- [ ] **Step 3: Rename the directories and scheme with `git mv`**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
git mv PFF Kiko
git mv PFF.xcodeproj Kiko.xcodeproj
git mv Kiko.xcodeproj/xcshareddata/xcschemes/PFF.xcscheme Kiko.xcodeproj/xcshareddata/xcschemes/Kiko.xcscheme
git mv PFF.xcworkspace Kiko.xcworkspace
```

- [ ] **Step 4: Edit `ios/Kiko.xcodeproj/project.pbxproj`**

Replace every `PFF` with `Kiko` EXCEPT the two `PRODUCT_BUNDLE_IDENTIFIER = com.dmytro.pff;` lines. Concretely, the surviving (post-deintegrate) refs to change are: the `PFF.app` product (`path = PFF.app`, `PFF.app in ...`), the group `name = PFF;` (two occurrences), `productName = PFF;`, the file-reference `path = PFF/Info.plist`, `path = PFF/Images.xcassets`, `path = PFF/AppDelegate.swift`, `path = PFF/PrivacyInfo.xcprivacy`, `path = PFF/LaunchScreen.storyboard`, `INFOPLIST_FILE = PFF/Info.plist;` (two build configs), and `PRODUCT_NAME = PFF;` (two build configs). A safe scripted form that protects the bundle id:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
perl -i -pe 's/(?<!com\.dmytro\.)PFF/Kiko/g' Kiko.xcodeproj/project.pbxproj
# Verify the bundle id is intact and no PFF remains:
grep -n 'com\.dmytro\.pff' Kiko.xcodeproj/project.pbxproj   # expect 2 lines
grep -n 'PFF' Kiko.xcodeproj/project.pbxproj                 # expect no output
```

(The negative-lookbehind `(?<!com\.dmytro\.)` guards the bundle id, whose casing is lowercase `pff` and therefore is not matched by uppercase `PFF` anyway — the guard is belt-and-suspenders.)

- [ ] **Step 5: Edit the workspace and scheme**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
perl -i -pe 's/PFF/Kiko/g' Kiko.xcworkspace/contents.xcworkspacedata
perl -i -pe 's/PFF/Kiko/g' Kiko.xcodeproj/xcshareddata/xcschemes/Kiko.xcscheme
```

This turns `group:PFF.xcodeproj` → `group:Kiko.xcodeproj`, `BuildableName "PFF.app"` → `"Kiko.app"`, `BlueprintName "PFF"` → `"Kiko"`, `ReferencedContainer "container:PFF.xcodeproj"` → `Kiko.xcodeproj`, and `PFFTests` → `KikoTests`.

- [ ] **Step 6: Edit the native source refs**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
perl -i -pe 's/"PFF"/"Kiko"/g' Kiko/AppDelegate.swift            # withModuleName: "Kiko"
perl -i -pe 's/text="PFF"/text="Kiko"/g' Kiko/LaunchScreen.storyboard
perl -i -pe "s/target 'PFF'/target 'Kiko'/g" Podfile
```

Do NOT edit `Kiko/Info.plist` — `CFBundleName` is `$(PRODUCT_NAME)` and `CFBundleDisplayName` is already `Кіко`.

- [ ] **Step 7: Reinstall Pods for the `Kiko` target**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
pod install
```

Expected: creates `Kiko.xcworkspace` integration, `Pods-Kiko.*` xcconfigs, regenerates `Podfile.lock`. `ios/Pods/**` stays gitignored. `Podfile.lock` is tracked; since dependencies are unchanged its pod list/checksums are identical (only integration metadata differs) — the `.gitleaks.toml` `ios/Podfile.lock` allowlist still applies.

- [ ] **Step 8: Verify the Xcode rename**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
xcodebuild -list -workspace Kiko.xcworkspace          # scheme + target = Kiko
grep -rn 'PFF' Kiko.xcodeproj Kiko.xcworkspace Kiko Podfile 2>/dev/null   # expect empty
grep -rn 'com\.dmytro\.pff' Kiko.xcodeproj/project.pbxproj                # expect 2 (bundle id preserved)
```

- [ ] **Step 9: Commit**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git add -A ios
git commit -m "refactor(ios): rename Xcode target PFF -> Kiko (bundle id unchanged)"
```

---

## Task 2: package & config rename

**Files:** all of Category B.

**Interfaces:**
- Produces: `app.json` `name = "Kiko"` (must equal `AppDelegate.swift` `withModuleName` from Task 1); `package.json` `name = "Kiko"`; `.npmrc` exemption `Kiko`; renamed semgrep rule ids `kiko-*`.

- [ ] **Step 1: Edit the manifests and configs**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
perl -i -pe 's/"name": "PFF"/"name": "Kiko"/; s/"displayName": "PFF"/"displayName": "Kiko"/' app.json
perl -i -pe 's/"name": "PFF"/"name": "Kiko"/' package.json
perl -i -pe 's/min-release-age-exclude\[\]=PFF/min-release-age-exclude[]=Kiko/' .npmrc
perl -i -pe 's/pff-security-stderr/kiko-security-stderr/g' scripts/checks/security.sh
perl -i -pe 's/\bpff-/kiko-/g' rules/semgrep-mobile.yml
perl -i -pe 's/pff-calendar/kiko-calendar/g; s/PFF hands/Kiko hands/g' jest.config.js
```

- [ ] **Step 2: Verify**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
grep -n 'PFF\|pff' app.json package.json .npmrc scripts/checks/security.sh rules/semgrep-mobile.yml jest.config.js   # expect empty
grep -c '"Kiko"' app.json    # expect 2
```

- [ ] **Step 3: Confirm the app-registration chain is consistent**

`app.json` `name` (`Kiko`) must equal `ios/Kiko/AppDelegate.swift` `withModuleName` (`Kiko`, from Task 1) and `index.js` registers `AppRegistry.registerComponent(appName, …)` reading `name` from `app.json` — no edit to `index.js`, just verify:

```bash
grep -n 'appName' /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/index.js
grep -n 'withModuleName' /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios/Kiko/AppDelegate.swift
grep -n '"name"' /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/app.json
```

- [ ] **Step 4: Commit**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git add app.json package.json .npmrc scripts/checks/security.sh rules/semgrep-mobile.yml jest.config.js
git commit -m "refactor(config): rename PFF -> Kiko in package/app manifests, npmrc, semgrep ids, security temp file"
```

---

## Task 3: app source rename (calendar files + skill-path comments)

**Files:** all of Category C.

**Interfaces:**
- Consumes: skill name `kiko-design-system` (Task 4) and doc path `2026-08-30-kiko-foundation-design.md` (Task 6) — the comment refs edited here must match those renames.
- Produces: `KikoCalendarProps`, `KikoCalendar` (default export of `src/screens/calendar`).

**HAZARD (read before running):** `src/db/client.ts:12` (`name: 'pff.db'`) and `src/monobank/token.ts:3` (`'pff.monobank.token'`) are on-device persistence identifiers. Renaming `pff.db` orphans all existing local financial data; renaming `pff.monobank.token` orphans the stored Monobank token in the iOS Keychain. Both are the same data-preservation class as the untouched bundle id. **This task explicitly does NOT change them.** If the user later wants `kiko.db`/`kiko.monobank.token`, that needs a separate data-migration plan (copy-on-first-launch), not a rename. The scripts below target only the calendar files and skill-path comments, never these two files.

- [ ] **Step 1: Rename the calendar files with `git mv`**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/src/screens/calendar
git mv pff-calendar.props.d.ts kiko-calendar.props.d.ts
git mv pff-calendar.component.tsx kiko-calendar.component.tsx
git mv pff-calendar.component.test.tsx kiko-calendar.component.test.tsx
git mv pff-calendar.day-cell-color.test.tsx kiko-calendar.day-cell-color.test.tsx
```

- [ ] **Step 2: Rewrite identifiers, imports, and comments inside the calendar dir**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/src/screens/calendar
perl -i -pe 's/pff-calendar/kiko-calendar/g; s/PffCalendar/KikoCalendar/g' \
  index.ts kiko-calendar.props.d.ts kiko-calendar.component.tsx \
  kiko-calendar.component.test.tsx kiko-calendar.day-cell-color.test.tsx
```

This covers: `index.ts` re-export path; `KikoCalendarProps` type + its import; the `KikoCalendar` const/default export; the test `describe`/JSX usages; and the day-cell comment refs.

- [ ] **Step 3: Rename the default-import alias in the two consumers**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
perl -i -pe 's/PffCalendar/KikoCalendar/g' \
  src/screens/forms/date-field/date-field.component.tsx \
  src/screens/home/date-range-field/date-range-field.component.tsx
```

- [ ] **Step 4: Rewrite the skill/doc path comments in design-system source**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
perl -i -pe 's/pff-design-system/kiko-design-system/g' \
  src/design-system/components/bottom-sheet/bottom-sheet.component.tsx \
  src/design-system/components/bottom-sheet/bottom-sheet.styles.ts \
  src/design-system/theme.ts
perl -i -pe 's/2026-08-30-pff-foundation-design/2026-08-30-kiko-foundation-design/g' src/design-system/theme.ts
```

- [ ] **Step 5: Confirm the hazards are untouched, then run the affected tests**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
grep -n 'pff.db' src/db/client.ts             # expect: still present (unchanged)
grep -n 'pff.monobank.token' src/monobank/token.ts   # expect: still present (unchanged)
git grep -n 'pff\|PFF\|Pff' -- 'src/**' ':!src/db/client.ts' ':!src/monobank/token.ts'   # expect empty
npx jest src/screens/calendar src/screens/forms/date-field src/screens/home/date-range-field
```

Expected: tests pass; the only residual `pff` in `src/` is the two intentional persistence identifiers.

- [ ] **Step 6: Commit**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git add -A src
git commit -m "refactor(src): rename PffCalendar -> KikoCalendar and skill/doc path comments (keep pff.db, keychain service)"
```

---

## Task 4: project skills rename

**Files:** all of Category D (`.claude/skills/pff-*`).

**Interfaces:**
- Consumes: renamed doc filename `2026-08-30-kiko-foundation-design.md` (Task 6) and harness path `harness/kiko/` (Task 5) — referenced in skill bodies.
- Produces: skills `kiko-architecture`, `kiko-charts`, `kiko-code-style`, `kiko-design-system`, `kiko-domain`, `kiko-gestures` (dir name == `name:` frontmatter == every cross-reference).

- [ ] **Step 1: Rename the six skill directories with `git mv`**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/.claude/skills
for s in architecture charts code-style design-system domain gestures; do
  git mv "pff-$s" "kiko-$s"
done
```

- [ ] **Step 2: Rewrite each SKILL.md**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/.claude/skills
perl -i -pe 's/pff-(architecture|charts|code-style|design-system|domain|gestures)/kiko-$1/g;
             s/2026-08-30-pff-foundation-design/2026-08-30-kiko-foundation-design/g;
             s|harness/pff/|harness/kiko/|g;
             s/# PFF /# Kiko /g;
             s/\bPFF\b/Kiko/g' \
  kiko-architecture/SKILL.md kiko-charts/SKILL.md kiko-code-style/SKILL.md \
  kiko-design-system/SKILL.md kiko-domain/SKILL.md kiko-gestures/SKILL.md
```

This updates the `name:` frontmatter (`pff-architecture` → `kiko-architecture` …), the `# PFF ...` titles, sibling cross-refs, the `Source of truth:` doc path, and the harness skill path.

- [ ] **Step 3: Verify**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
grep -rn 'PFF\|pff' .claude/skills/   # expect empty
grep -rn '^name:' .claude/skills/*/SKILL.md   # each should read kiko-*
```

- [ ] **Step 4: Commit**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git add -A .claude/skills
git commit -m "refactor(skills): rename project skills pff-* -> kiko-*"
```

---

## Task 5: harness / plugin rename (self-referential — keep mutually consistent)

**Files:** all of Category E.

**Interfaces:**
- Produces: plugin `kiko` in marketplace `kiko-marketplace`; enabled in `.claude/settings.json` as `kiko@kiko-marketplace`; agents referencing the `kiko:` namespace and `harness/kiko/` paths.

**Self-referential hazard:** four strings must agree after this task — (1) `marketplace.json` plugin `name`, (2) `plugin.json` `name`, (3) the `.claude/settings.json` key `<plugin>@<marketplace>`, and (4) every `pff:`→`kiko:` namespace reference inside agents/skills/CLAUDE.md. If any one lags, the plugin fails to load or agent references dangle. Do the directory move, then the manifests, then settings, then a repo-wide harness sweep, then verify all four in one grep.

- [ ] **Step 1: Move the plugin directory**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/harness
git mv pff kiko
```

- [ ] **Step 2: Rewrite the two manifests and settings**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
perl -i -pe 's/pff-marketplace/kiko-marketplace/g;
             s/"name": "pff"/"name": "kiko"/g;
             s|"source": "\./pff"|"source": "./kiko"|g;
             s/"name": "PFF"/"name": "Kiko"/g;
             s/\bPFF\b/Kiko/g' harness/.claude-plugin/marketplace.json
perl -i -pe 's/"name": "pff"/"name": "kiko"/g;
             s/"name": "PFF"/"name": "Kiko"/g;
             s/\bPFF\b/Kiko/g' harness/kiko/.claude-plugin/plugin.json
perl -i -pe 's/pff\@pff-marketplace/kiko\@kiko-marketplace/g' .claude/settings.json
```

- [ ] **Step 3: Sweep the harness bodies, inventory doc, and CLAUDE.md**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
perl -i -pe 's|harness/pff/|harness/kiko/|g;
             s/\bpff:/kiko:/g;
             s/\bpff-/kiko-/g;
             s/\bPFF\b/Kiko/g;
             s/\bpff\b/kiko/g' \
  harness/kiko/agents/*.md \
  harness/kiko/commands/ponytail-review.md \
  harness/kiko/skills/design-system/SKILL.md \
  harness/kiko/skills/harness-workflow/SKILL.md \
  harness/kiko/skills/ops/SKILL.md \
  harness/kiko/skills/retrospect/SKILL.md \
  docs/harness/review-to-biome-inventory.md
```

For `CLAUDE.md`, the 8 hits are all harness/package prose (`harness/pff/`, `pff` plugin, `min-release-age-exclude[]=PFF`, `harness/pff/commands/ponytail-review.md`) with no immutable tokens — sweep it the same way:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
perl -i -pe 's|harness/pff/|harness/kiko/|g;
             s/`pff`/`kiko`/g;
             s/\bpff:/kiko:/g;
             s/min-release-age-exclude\[\]=PFF/min-release-age-exclude[]=Kiko/g;
             s/\bPFF\b/Kiko/g' CLAUDE.md
```

- [ ] **Step 4: Confirm `hooks.json` needs no content edit**

```bash
grep -n 'pff\|PFF' /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/harness/kiko/hooks/hooks.json   # expect empty (uses ${CLAUDE_PROJECT_DIR})
```

- [ ] **Step 5: Verify the four names agree and no stray refs remain**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
grep -n 'name' harness/.claude-plugin/marketplace.json harness/kiko/.claude-plugin/plugin.json   # kiko / kiko-marketplace / ./kiko
grep -n 'kiko@kiko-marketplace' .claude/settings.json
grep -rn 'PFF\|pff' harness/ docs/harness/ CLAUDE.md   # expect empty
```

- [ ] **Step 6: Commit**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git add -A harness .claude/settings.json docs/harness CLAUDE.md
git commit -m "refactor(harness): rename plugin pff -> kiko (marketplace, agents, skills, hooks path, settings)"
```

---

## Task 6: docs rename

**Files:** all of Category F.

**Interfaces:**
- Consumes: nothing (docs are leaf artifacts).
- Produces: renamed plan/spec filenames referenced by the skills (Task 4) and plan headers.

**Preserve-list hazard:** doc prose mixes renamable product/harness references with immutable git/worktree/repo tokens. The one collision is lowercase `pff`; uppercase `PFF` and mixed `Pff` never appear inside a preserved token, so those are unconditionally safe. The script below replaces `PFF`→`Kiko` and `Pff`→`Kiko` everywhere, and replaces lowercase `pff`→`kiko` EXCEPT where it is part of `pff-ios`, follows `drizzer14/`, follows a `workspaces/pff-ios/` path (worktree slug), or is one of the dotted persistence/bundle tokens.

- [ ] **Step 1: Rename the doc files with `git mv`**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git mv docs/superpowers/plans/2026-08-30-pff-agent-plugin.md          docs/superpowers/plans/2026-08-30-kiko-agent-plugin.md
git mv docs/superpowers/plans/2026-08-30-pff-foundation.md            docs/superpowers/plans/2026-08-30-kiko-foundation.md
git mv docs/superpowers/plans/2026-08-30-pff-quality-harness.md       docs/superpowers/plans/2026-08-30-kiko-quality-harness.md
git mv docs/superpowers/plans/2026-08-30-pff-scaffold.md              docs/superpowers/plans/2026-08-30-kiko-scaffold.md
git mv docs/superpowers/plans/2026-08-31-pff-redesign-phase-1.md      docs/superpowers/plans/2026-08-31-kiko-redesign-phase-1.md
git mv docs/superpowers/plans/2026-08-31-pff-redesign-phase-2.md      docs/superpowers/plans/2026-08-31-kiko-redesign-phase-2.md
git mv docs/superpowers/plans/2026-08-31-pff-redesign-phase-3.md      docs/superpowers/plans/2026-08-31-kiko-redesign-phase-3.md
git mv docs/superpowers/plans/2026-08-31-pff-redesign-phase-4.md      docs/superpowers/plans/2026-08-31-kiko-redesign-phase-4.md
git mv docs/superpowers/plans/2026-08-31-pff-redesign-phase-5.md      docs/superpowers/plans/2026-08-31-kiko-redesign-phase-5.md
git mv docs/superpowers/plans/2026-09-01-pff-redesign-feedback-round-1.md docs/superpowers/plans/2026-09-01-kiko-redesign-feedback-round-1.md
git mv docs/superpowers/specs/2026-08-30-pff-foundation-design.md     docs/superpowers/specs/2026-08-30-kiko-foundation-design.md
git mv docs/superpowers/specs/2026-08-30-pff-scaffold-and-harness-design.md docs/superpowers/specs/2026-08-30-kiko-scaffold-and-harness-design.md
git mv docs/superpowers/specs/2026-08-31-pff-redesign-design.md       docs/superpowers/specs/2026-08-31-kiko-redesign-design.md
```

- [ ] **Step 2: Content replace across all docs with the preserve-list**

Run this Python replacer (deterministic; protects every immutable token). It skips this very plan file, which is the documented subject-mention exception.

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
python3 - <<'PY'
import re, subprocess
SELF = "docs/superpowers/plans/2026-09-04-rename-pff-to-kiko.md"
files = subprocess.check_output(
    ["git", "grep", "-Il", "-e", "pff", "-e", "PFF", "--", "docs/"]
).decode().split()
# Placeholders for tokens that must survive verbatim.
PRESERVE = [
    "com.dmytro.pff",
    "pff.monobank.token",
    "pff.db",
    # branch refs
    "drizzer14/pff-app-store", "drizzer14/pff-consolidated", "drizzer14/pff-ios",
    "drizzer14/pff-redesign-phase-1", "drizzer14/pff-redesign-review",
    "drizzer14/pff-statistics", "drizzer14/pff-ux-round",
    # worktree paths (dir + slug together)
    "workspaces/pff-ios/pff-app-store", "workspaces/pff-ios/pff-redesign-phase-1",
    "workspaces/pff-ios/pff-statistics", "workspaces/pff-ios/pff-ux-round",
    "workspaces/pff-ios",
    # repo dir (must come last of the pff-ios group)
    "pff-ios",
]
for f in files:
    if f == SELF:
        continue
    s = open(f, encoding="utf-8").read()
    # 1. Mask preserved tokens (longest first so prefixes don't win).
    holds = {}
    for i, tok in enumerate(sorted(PRESERVE, key=len, reverse=True)):
        key = f"\x00{i}\x00"
        if tok in s:
            s = s.replace(tok, key)
            holds[key] = tok
    # 2. Case-preserving replace on the rest.
    s = s.replace("PFF", "Kiko").replace("Pff", "Kiko").replace("pff", "kiko")
    # 3. Restore preserved tokens.
    for key, tok in holds.items():
        s = s.replace(key, tok)
    open(f, "w", encoding="utf-8").write(s)
    print("rewrote", f)
PY
```

This also fixes doc-internal cross-references to the renamed filenames (e.g. `2026-08-30-pff-foundation-design.md` → `...-kiko-...`) because those are date-prefixed, not `drizzer14/`- or `workspaces/`-anchored, so they are replaced.

- [ ] **Step 3: Verify only intended tokens remain**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
# Show every residual pff/PFF in docs; each hit must be a MUST-NOT-CHANGE token
# (pff-ios, drizzer14/pff-*, workspaces/pff-ios/pff-*, com.dmytro.pff, pff.db,
#  pff.monobank.token) or inside this plan file.
git grep -n 'pff\|PFF' -- 'docs/**'
```

Review the output by eye: confirm no product/harness reference slipped through and no immutable token was mangled.

- [ ] **Step 4: Commit**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git add -A docs
git commit -m "docs: rename pff -> kiko (preserve repo/branch/worktree slugs, bundle id, persistence ids)"
```

---

## Task 7: whole-repo verification

**Goal:** prove zero residual `pff`/`PFF` outside the documented exceptions, and that the harness + tests are green.

- [ ] **Step 1: Residual-token audit (case-sensitive, both cases)**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git grep -n 'pff\|PFF\|Pff' -- . ':!package-lock.json'
```

Expected: every remaining line is one of these documented, legitimate exceptions —
- `ios/*/project.pbxproj` — `com.dmytro.pff` (bundle id, ×2)
- `src/db/client.ts` — `pff.db`
- `src/monobank/token.ts` — `pff.monobank.token`
- `docs/**` — `pff-ios`, `drizzer14/pff-*`, `workspaces/pff-ios/pff-*`, `com.dmytro.pff`
- `docs/superpowers/plans/2026-09-04-rename-pff-to-kiko.md` — this plan's subject mentions

Anything else is a miss to fix before proceeding.

- [ ] **Step 2: Confirm no `pff` filename or directory survives (except the repo root)**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git ls-files | grep -i 'pff'
find . -path ./node_modules -prune -o -path ./ios/Pods -prune -o -iname '*pff*' -print
```

Expected: only `docs/superpowers/plans/2026-09-04-rename-pff-to-kiko.md` (this plan) from `git ls-files`; `find` may additionally surface the untracked-but-ignored `ios/Pods` if not pruned — ignore those. No `ios/PFF*`, no `.claude/skills/pff-*`, no `harness/pff`.

- [ ] **Step 3: Run the JS/TS harness checks**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
npm run check:lint     # Biome — formatting/lint on renamed files
npm run check:knip     # unused files/exports/deps — catches a dangling import after a rename
npm run check:deps     # depcheck + npm ci --dry-run — package.json name change must not break the lockfile
npm test               # full Jest suite (calendar rename + everything else)
```

Expected: all green. `check:knip`/`check:deps` are the ones most likely to catch a rename miss (a stale import path or a dep name mismatch).

- [ ] **Step 4: Run the composite fast+medium tier**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
npm run check:all      # lint, dup, knip, deps, security, secrets, overrides
```

Expected: green. `check:security` re-runs Semgrep with the renamed `kiko-*` rule ids; `check:secrets` (gitleaks) must stay green given `ios/build-attempt2.log` was removed and `Podfile.lock` is allowlisted.

- [ ] **Step 5: iOS build sanity (ops/developer, on a Mac with the toolchain)**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko/ios
xcodebuild -list -workspace Kiko.xcworkspace     # scheme = Kiko, target = Kiko
```

Then a device/simulator build via the normal RN flow (out of scope for this plan to script — hand off to `ops`). The bundle id `com.dmytro.pff` must be unchanged, so the app installs over the existing on-device copy and keeps its `pff.db` data and Keychain token.

- [ ] **Step 6: Final commit / branch wrap-up**

The per-task commits already cover the work. Confirm a clean tree:

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/rename-pff-to-kiko
git status
git log --oneline base..HEAD
```

---

## Self-Review

**Spec coverage:** iOS project (Task 1), package/config (Task 2), source (Task 3), project skills (Task 4), harness/plugin (Task 5), docs (Task 6), verification (Task 7). Case preservation is enforced by the case-split `perl`/Python replacers. Bundle id, `pff.db`, and Keychain service are protected by explicit exclusions and hazard notes. Repo dir and branch/worktree slugs are protected by the docs preserve-list. `git mv` is used for every tracked rename. Self-referential harness consistency (four-name check) is Task 5 Step 5.

**Placeholder scan:** every step has an exact command or file edit; no TBD/TODO.

**Type/name consistency:** `KikoCalendarProps`/`KikoCalendar` used consistently across Task 3; plugin name `kiko` == marketplace-source `./kiko` == settings `kiko@kiko-marketplace` in Task 5; skill dir name == `name:` frontmatter in Task 4; renamed doc filenames in Task 6 match the `Source of truth:` refs updated in Tasks 3 and 4.

## Resolved decisions (confirmed with the user — these override the "keep" defaults above)

1. **`pff.db` and `pff.monobank.token` ARE renamed in SOURCE in this pass.** Per the user's explicit direction, `src/db/client.ts` `open({ name: 'pff.db' })` → `open({ name: 'kiko.db' })` and `src/monobank/token.ts` `const service = 'pff.monobank.token'` → `'kiko.monobank.token'` are changed as part of the normal rename. NO on-device migration code is added in this pass — a separate later pass (`docs/superpowers/plans/2026-09-04-security-and-app-lock.md`) owns the copy-on-first-launch/SQLCipher migration. Consequence to accept: until that pass ships, a build opens a fresh `kiko.db` and does not read the existing on-device `pff.db`. **In DOCS these two tokens are still preserved verbatim** — the security-and-app-lock plan/spec reference `pff.db`/`pff.monobank.token` (and `pff.db.key`) as the *real legacy on-device identifiers* that the future migration must read; renaming them in those docs would corrupt the migration design. So the Task 6 preserve-list keeps `pff.db`, `pff.monobank.token`, and `pff.db.key` in docs, and the residual-token audit (Task 7) will legitimately still surface them under `docs/**`.
2. **`ios/build-attempt2.log` IS removed** via `git rm` (stale build artifact, ~3100 `PFF` hits, `ios/build/` is already gitignored).
