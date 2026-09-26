# Pre-write guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `PreToolUse` hook on `Edit|Write|MultiEdit` rebuilds the proposed `.ts`/`.tsx` content. It denies the write when the edit ADDS a violation of one of the 17 spec rules.

**Architecture:** `scripts/checks/pre-write-guard.sh` is a thin fail-closed wrapper around `scripts/checks/pre-write-guard.js`, a CommonJS orchestrator. The orchestrator does these steps in order:
- Parse stdin.
- Rebuild BEFORE and AFTER.
- Write both trees under one `mkdtemp` root that mirrors the repo-relative path (`<temporary>/before/<relative>`, `<temporary>/after/<relative>`).
- Run ONE Semgrep process over both trees with `rules/semgrep-prewrite.yml`.
- Run the Node checks for rules 4, 5, 6, 11, and 12.
- Drop justified overrides.
- Diff the findings on the key `(rule id, normalized text, occurrence index)`.
- Emit deny JSON for new findings only.

The four Tier-1 Semgrep rule bodies MOVE from `rules/semgrep-mobile.yml` into `rules/semgrep-prewrite.yml` in one commit. Every full-tree loader then loads both files.

**Tech Stack:** bash 3.2 (macOS system bash), Node 22 (CommonJS, `--experimental-strip-types` for the one `.ts` checker), Semgrep 1.175, Jest (spawn-the-real-wrapper tests, the `__tests__/kill-guard.test.ts` / `__tests__/full-word-identifiers.test.ts` pattern).

**Spec:** `docs/superpowers/specs/2026-09-25-pre-write-guard-design.md` (commit `51f05e8`). Read it with this plan. Where this plan deviates from the spec, the task gives the reason and it is listed in "Spec deviations" below.

## Global Constraints

- Scope: `.ts`/`.tsx` only. Always excluded: `rules/fixtures/**`, `node_modules/**`, `ios/**`, `android/**`, and any path outside `CLAUDE_PROJECT_DIR`.
- The guard's own files are `.sh`, `.js`, and `.yml` only. A broken guard must never block the edit that fixes it. Rule 6's `.ts` checker is loaded only for `.tsx` targets, so editing it is never blocked by itself.
- Fail closed: any internal error, unexpected Semgrep exit (not 0 or 1), Node-check crash, missing `rules/semgrep-prewrite.yml`, or internal timeout is a DENY. The only no-op is the `[ -f "$f" ] || exit 0` in `hooks.json` (the script is absent).
- Deny output: the spec's `hookSpecificOutput` deny JSON on stdout (the `kill-guard.js` shape), the same reason text on stderr, then `exit 2`. Claude Code reads stdout JSON only on exit 0 and uses stderr on exit 2, so both channels carry the reason and the deny holds either way.
- Speed target: p50 and p95 under 3 s per edit, measured on real repo files (Task 20).
- Standing rule: fix the underlying issue. Never weaken a check. No `|| true`. No bare `nosemgrep`, `kiko-override`, or `biome-ignore`.
- Full words in every NEW identifier: file names, functions, variables, rule ids, and fixture code. Never `err`, `msg`, `res`, `tmp`, `cfg`, `opts`, `e`, `idx`, `acc`, `val`, `prev`, `str`, `obj`, `arr`, `num`, `cb`, `ctx`, `el`, `btn`, `tx`, or `cond` (the `scripts/checks/full-word-identifiers.js` `DENYLIST`). Write `temporaryRoot`, `error`, `message`, `options`, `index`.
- A `.good.` fixture must follow EVERY rule: zero findings from both Semgrep configs, and correct import order, full words, blank lines, and one component per file. A `.bad.` fixture violates only its own rule.
- A new ERROR rule lands with its sweep of the existing violations in the SAME commit.
- Never run `git checkout`, `restore`, `stash`, or `clean`. Never pattern-kill. The guard may kill only a child PID it spawned (via the `spawnSync` `timeout` option).
- New Semgrep rules carry `metadata.fix` (the correct pattern) and `metadata.skill` (for example `kiko-code-style › Import ordering`). The deny reason prints both.
- The end gate is `make verify`, run once at the end until it is green (Task 22). `make deep` stays the separate pre-done gate (Task 22, coordinator).

## Spec deviations (flag to the coordinator before the owning task)

1. **Rule 12 is a Node check, not Semgrep** (Task 18). Semgrep cannot resolve a relative import (`../../account-detail/x`) against the importing file's own folder, and the tree uses relative imports throughout.
2. **Rule 13 uses nested fixtures** `rules/fixtures/<rule-id>/src/monobank/<name>.(bad|good).ts` (Task 12). A path-scoped `paths.include` never matches a flat fixture. On 2026-09-25 the author verified that `include: ["src/monobank/**"]` matches a mirrored nested fixture and a mirrored temp root, which needs a small `semgrep-rules.sh` extension.
3. **Rule 16 is BLOCKED on a user decision** (Task 16). The code deliberately makes the Sync button `variant="primary"`. See the comments in `src/screens/account-detail/bank-sync-section/bank-sync-section.component.tsx:227-230` and `crypto-sync-section.component.tsx:102-104`. Change bank is `variant="ghost"` (`bank-sync-section.component.tsx:318-320`). The spec pins both to `secondaryTonal`. The user picks one: follow the spec and re-style both, or keep `primary` for Sync and pin that instead.
4. **Rule 8's allowlist** is `src/design-system/palette.ts` and `src/design-system/theme.ts`, plus `*.test.ts(x)` files. `src/design-system/theme/` does not exist. Test files assert rendered colors against literal oracles, which is the same reasoning as `kiko-no-textdecoder-textencoder`'s test exclusion.
5. **One Semgrep process scans both trees, and the BEFORE pass is skipped when AFTER is clean.** The result is the same as two runs (`new = AFTER \ BEFORE`, and an empty AFTER means nothing is new). A single run costs about 1.6 s, so two runs miss the 3 s target. The author verified on 2026-09-25 that path-prefixed excludes still apply under `before/` and `after/` roots.
6. **Rules 11 and 12 also get a project-wide `check:*` script in `check:all`**, added with their sweeps. Without it, "lands with its sweep" cannot be kept at zero.
7. **A plugin hook dispatcher replaces the literal `${CLAUDE_PROJECT_DIR}` in every `hooks.json` command** (Task 21b, approved by the coordinator 2026-09-26, `kiko:debugger`-verified). `CLAUDE_PROJECT_DIR` is the COORDINATOR's own checkout for a subagent's hook call, not necessarily the checkout that owns the edited file, so a subagent of a session started in the main checkout ran the MAIN repo's `scripts/checks/*` against a worktree file (the fast tier missed a Class A finding on `feat`), and this guard would have treated every worktree edit as "outside the project" and allowed it unchecked. `harness/kiko/hooks/dispatch.sh` resolves the edited file's own worktree root (`git rev-parse --show-toplevel`, walking up to the nearest existing ancestor for a new file's not-yet-created directory; the payload's own `cwd` for a tool-less hook; `CLAUDE_PROJECT_DIR` as the last-resort fallback) and execs that worktree's own script with `CLAUDE_PROJECT_DIR` set to the resolved root, replaying stdin byte-for-byte and passing stdout/stderr/exit code through unchanged. Every `hooks.json` entry becomes `bash "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch.sh" <script-name>.sh` — `CLAUDE_PLUGIN_ROOT` (not `CLAUDE_PROJECT_DIR`) locates the dispatcher itself, but it is NOT the physical `harness/kiko/` directory in this checkout: Claude Code resolves it to the plugin's CACHE copy (`~/.claude/plugins/cache/kiko-marketplace/kiko/<version>/`), refreshed only on a plugin reinstall or a `plugin.json` version bump — not on every commit here. `harness/kiko/.claude-plugin/plugin.json`'s `version` has never been bumped in this repo's history, so bumping it is not this repo's convention; Task 21b's own dispatcher/hooks.json changes need a plugin reinstall (or equivalent forced cache rebuild) before `/reload-plugins` can pick them up in a running session — a plain branch merge is not enough. A dispatcher-own crash (malformed JSON, `node` missing, or `mktemp` failing to even buffer stdin) is handled by DELEGATION, not a second deny path, except for a genuine `git rev-parse` failure (fix round 2, g5b): only a "not a git repository" case falls back to `CLAUDE_PROJECT_DIR` this way; any OTHER git failure, and `mktemp` failing outright, both deny for `pre-write-guard.sh` and no-op for every other hook (kept semantics), rather than silently letting an unchecked write through. The resolved root is also bound to `CLAUDE_PROJECT_DIR`'s own repository (same repo, or a linked worktree of it) — an unrelated repository falls back to `CLAUDE_PROJECT_DIR` instead of running its own scripts against `CLAUDE_PROJECT_DIR`'s rules. See `docs/superpowers/specs/2026-09-25-pre-write-guard-design.md` ("Trigger and wiring") and `__tests__/hook-dispatch.test.ts`.

## Merge-overlap risk with `feat/assets-debts`

The feat track edits `rules/semgrep-mobile.yml`, `scripts/checks/*`, and `src/**` concurrently. How this plan keeps the overlap small:
- The rule move is ONE commit (Task 4): the deletion from `semgrep-mobile.yml`, the new file, and every loader update land together. No landed state has a rule body in both files or in neither.
- Each task is a small, separately reviewable commit. A conflict then touches one rule, not a mixed batch.
- The two sweeps with the most conflicts come LAST, right after a merge of the feat tip (Task 17): rule 12 moves 17 modules across screens (Task 18), and rule 11 adds about 600 blank lines across about 155 files (Task 19). Rule 11's sweep is fully mechanical (`blank-line-separation.js --write`). On a conflict, take feat's side of the file and re-run the fixer instead of hand-merging.
- The coordinator merges the feat tip again before the final review (Task 23). At every merge it diffs `rules/semgrep-mobile.yml` explicitly. A conflict is resolved by keeping the move intact: a rule body the feat track edited in `semgrep-mobile.yml` moves into `semgrep-prewrite.yml` along with the feat edit.

## Review Focus

1. The Edit tool's `old_string` is not found verbatim, for example after curly-quote or CRLF normalization. Expected: DENY with "the guard could not find old_string; re-read the file". Never allow an unchecked write. (Task 2 test.)
2. `file_path` goes through a symlink, or `/tmp` vs `/private/tmp`, or sits outside the project. Expected: both sides are resolved with `realpath` before relativizing. Outside the project means allow. Inside means checked. (Task 1 test.)
3. A hung Semgrep or Node child. Expected: the internal deadline (`KIKO_PREWRITE_TIMEOUT_MS`, default 25000, under the hook's 30 s) kills only that child and DENIES. It never hangs to the hook timeout. (Task 1 test.)
4. Parallel agents edit in one worktree. Expected: each invocation gets its own `mkdtemp` root, which is removed on every exit path (allow, deny, crash). (Task 1 test.)
5. An edit adds or removes an override comment. Expected: an added justified override makes the write proceed. Deleting a justified override that suppressed a BEFORE finding makes that finding new, and the write is denied. (Task 7 test.)

---

## File map

| File | Role | Task |
|---|---|---|
| `scripts/checks/pre-write-guard.sh` | hook entry; fail-closed wrapper; deny on node crash/missing | 1 |
| `scripts/checks/pre-write-guard.js` | orchestrator: payload, scope, rebuild, mirrored trees, checks, diff, overrides, deny | 1-7, 18 |
| `__tests__/pre-write-guard.test.ts` | spawn-the-wrapper Jest suite, stub Semgrep via `KIKO_PREWRITE_SEMGREP_BIN` | 1-7 |
| `__tests__/pre-write-guard-rules.test.ts` | real-Semgrep integration: every prewrite rule's `.bad` fixture denies through the guard | 4, 9-16 |
| `rules/semgrep-prewrite.yml` | the pre-write rule set (Tier-1 moved + Tier-2/3 new) | 4, 9-16 |
| `rules/semgrep-mobile.yml` | loses the 4 moved rule bodies | 4 |
| `scripts/checks/security.sh`, `scripts/checks/semgrep-rules.sh` | load both configs; fingerprint both | 4 (+12 nested fixtures) |
| `scripts/checks/blank-line-separation.js` (+ `.sh`) | rule 11 checker/fixer | 6, 19 |
| `scripts/checks/screen-imports.js` (+ `.sh`) | rule 12 checker | 18 |
| `scripts/checks/override-guard.sh` | also bare `nosemgrep:` / `kiko-override:` | 8 |
| `__tests__/override-guard.test.ts`, `__tests__/blank-line-separation.test.ts`, `__tests__/screen-imports.test.ts` | Jest | 6, 8, 18 |
| `knip.json`, `docs/harness/documented-exceptions.md` | knip `ignore` for each new spawned-only `.js` | 1, 6, 18 |
| `package.json` | `check:blank-line-separation`, `check:screen-imports` in `check:all` | 18, 19 |
| `harness/kiko/hooks/hooks.json` | new `PreToolUse` matcher (branch AND main) | 21 |
| `CLAUDE.md`, `.claude/skills/kiko-linter/SKILL.md`, `harness/kiko/skills/harness-workflow/SKILL.md`, `docs/harness/review-to-biome-inventory.md`, other skill citations | docs | 4, 22 |

## Shared interfaces (all in `scripts/checks/pre-write-guard.js`)

```js
// Finding: { ruleId: string, tree: 'before' | 'after', line: number,
//            matchedText: string, fix: string, skill: string }
readPayload(text) -> { toolName, filePath, toolInput }          // throws on malformed
relativeInProject(filePath, projectDirectory) -> string | null  // realpath both; null = outside
isInScope(relativePath) -> boolean
rebuildContents(toolName, toolInput, beforeText) -> string      // throws RebuildError
writeMirroredTrees(relativePath, beforeText, afterText) -> { temporaryRoot, beforePath, afterPath }
runSemgrep(temporaryRoot, relativePath, trees) -> Finding[]     // trees: ['after'] or ['before','after']
runNodeChecks(temporaryRoot, relativePath, tree) -> Finding[]
normalizeText(text) -> string                                   // collapse \s+ to ' ', trim
findingKeys(findings) -> Map<string, Finding>                   // key = ruleId \0 normalized \0 occurrence
newFindings(beforeFindings, afterFindings) -> Finding[]
overrideState(sourceLines, line, ruleId) -> 'justified' | 'bare' | 'none'
denyReason(relativePath, findings) -> string
```

Env seams (test-only, harness-side, same shape as `KIKO_MUTATION_BIN`): `KIKO_PREWRITE_SEMGREP_BIN` (default `semgrep`), `KIKO_PREWRITE_NODE_BIN` (default `node`, for the spawned checkers), `KIKO_PREWRITE_RULES` (default `$ROOT/rules/semgrep-prewrite.yml`), `KIKO_PREWRITE_TIMEOUT_MS` (default `25000`). The guard reads `CLAUDE_PROJECT_DIR` (default: the repo root derived from the script's own location) to relativize `file_path`. Rules and checkers always load from the script's own repo.

Node rule ids: `kiko-import-order` (4), `kiko-full-word-identifiers` (5), `kiko-one-component-per-file` (6), `kiko-blank-line-separation` (11), `kiko-no-cross-screen-import` (12). The fix text and skill pointer for each live in one `NODE_RULES` table in `pre-write-guard.js`.

---

### Task 1: Guard skeleton — wrapper, scope, fail-closed, deny shape

**Role:** developer
**Files:** Create `scripts/checks/pre-write-guard.sh`, `scripts/checks/pre-write-guard.js`, `__tests__/pre-write-guard.test.ts`. Modify `knip.json` (`ignore` += `scripts/checks/pre-write-guard.js`) and `docs/harness/documented-exceptions.md` (knip entry: the file is spawned by bash only, the same reason as `kill-guard.js`).

- [ ] **Step 1: Write the failing tests.** Follow the `__tests__/kill-guard.test.ts` pattern: `spawnSync('bash', [SCRIPT], { input, encoding: 'utf8', env })`. `env` sets `CLAUDE_PROJECT_DIR` to a `mkdtempSync` project and `KIKO_PREWRITE_SEMGREP_BIN` to a stub written into that temp dir. The stub is a bash script that prints `{"results":[],"errors":[],"paths":{"scanned":[...]}}` and exits with the code in `STUB_EXIT`, or sleeps when `STUB_SLEEP` is set. Cases:

```ts
it('allows a non-.ts/.tsx file without running semgrep', ...);           // README.md; stub writes a marker file -> assert absent
it('allows a path under rules/fixtures/', ...);                            // rules/fixtures/x.bad.ts
it('allows a .ts file outside CLAUDE_PROJECT_DIR', ...);
it('resolves a symlinked project path before relativizing', ...);          // Review Focus 2
it('denies on malformed stdin JSON', ...);                                  // status 2, stdout deny JSON, stderr non-empty
it('denies when semgrep exits neither 0 nor 1', ...);                       // STUB_EXIT=3
it('denies when rules/semgrep-prewrite.yml is unreadable', ...);           // KIKO_PREWRITE_RULES seam pointing at a missing file
it('denies on internal timeout and leaves no temp root', ...);              // STUB_SLEEP=5, KIKO_PREWRITE_TIMEOUT_MS=500; Review Focus 3
it('removes its temp root on allow, deny, and crash', ...);                 // TMPDIR=<test dir>; assert empty afterwards; Review Focus 4
it('prints the documented deny JSON shape', () => {
  // JSON.parse(stdout).hookSpecificOutput ===
  // { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.any(String) }
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** `npx jest __tests__/pre-write-guard.test.ts`. Expected: FAIL, because the script does not exist.
- [ ] **Step 3: Implement.**
  - `pre-write-guard.sh`: `set -uo pipefail` (no `set -e`). It pipes stdin to `node --experimental-strip-types --no-warnings "$DIR/pre-write-guard.js"` and captures stdout/stderr and the exit code. 0 means exit 0. 2 means pass stdout/stderr through and exit 2. Any other code, or `node` missing, means the wrapper prints its own deny JSON: `printf` with the reason `"pre-write guard crashed (exit N): <stderr tail>"`, with the JSON built by a quoted heredoc and `sed` escaping of `"` and `\`. It also mirrors the reason to stderr and exits 2.
  - `pre-write-guard.js`: `readPayload`, `relativeInProject`, `isInScope`, and `writeMirroredTrees` (`fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-prewrite-'))`, removed in a `finally`). A stub `rebuildContents` returns `toolInput.content ?? ''`, and `runSemgrep` treats results as `[]` for now. Every child `spawnSync` gets `timeout: remainingBudget()`. A child killed by its timeout (`signal !== null`) throws. The top-level `try/catch` turns any throw into `emitDeny('pre-write guard could not check this edit: ' + error.message)`. Missing or unreadable rules also deny.
  - Keep a `require.main === module` guard.
- [ ] **Step 4: Run the tests and confirm they pass.** `npx jest __tests__/pre-write-guard.test.ts`
- [ ] **Step 5: Run the file-scoped checks.** `bash scripts/checks/lint.sh scripts/checks/pre-write-guard.js`, `node scripts/checks/full-word-identifiers.js scripts/checks/pre-write-guard.js __tests__/pre-write-guard.test.ts`, `node scripts/checks/import-order.js __tests__/pre-write-guard.test.ts`, `npm run check:knip`, `npm run check:import-order`.
- [ ] **Step 6: Commit** `feat(harness): pre-write guard skeleton, scope and fail-closed deny`.

### Task 2: Rebuild BEFORE/AFTER for Write, Edit, replace_all, MultiEdit

**Role:** developer
**Files:** Modify `scripts/checks/pre-write-guard.js` and `__tests__/pre-write-guard.test.ts`.

- [ ] **Step 1: Write the failing tests.** The stub Semgrep copies each target file it is given to `$CAPTURE_DIR/<before|after>.txt`. Assert the captured AFTER text, and the BEFORE text where the stub is asked to scan both trees (stub env `STUB_RESULTS` holds one AFTER finding so the guard runs the BEFORE pass):

```ts
it('Write, new file: BEFORE empty, AFTER = content', ...);                 // also Review Focus: all AFTER findings are new
it('Write, existing file: BEFORE = disk, AFTER = content', ...);
it('Edit: replaces the first occurrence only', ...);                        // disk 'a X b X', old 'X', new 'Y' -> 'a Y b X'
it('Edit replace_all: replaces every occurrence', ...);                     // -> 'a Y b Y'
it('MultiEdit: applies edits in array order on the running result', ...);   // [{X->Y},{Y->Z}] on 'X' -> 'Z'
it('denies when old_string is not found verbatim', ...);                    // Review Focus 1; reason contains 're-read'
it('mirrors the repo-relative path under before/ and after/', ...);        // stub records its argv: 'before/src/screens/a/a.screen.tsx' etc.
```

- [ ] **Step 2: Run and confirm FAIL.** `npx jest __tests__/pre-write-guard.test.ts -t "Write|Edit|MultiEdit|mirrors|old_string"`
- [ ] **Step 3: Implement `rebuildContents`.**
  - Use `String.prototype.split(old).join(new)` for `replace_all`.
  - Use `indexOf` + slice for a single replacement.
  - When `indexOf === -1`, throw `RebuildError('old_string not found; re-read the file and retry')`.
  - MultiEdit reduces over `toolInput.edits`.
  - Use `string.replace` with a function replacer, never a string replacer: `$&` in `new_string` must stay literal. Add a test for `new_string` containing `$&`.
- [ ] **Step 4: Run and confirm PASS.** Same command.
- [ ] **Step 5: Run the file-scoped checks** as in Task 1 Step 5, then **commit** `feat(harness): pre-write guard rebuilds proposed content per tool`.

### Task 3: Semgrep pass + new-findings-only diff

**Role:** developer
**Files:** Modify `scripts/checks/pre-write-guard.js` and `__tests__/pre-write-guard.test.ts`.

- [ ] **Step 1: Write the failing tests.** The stub returns canned Semgrep JSON for the before/after paths (`STUB_RESULTS_BEFORE`, `STUB_RESULTS_AFTER`, each a JSON array of `{check_id, path, start:{line,offset}, end:{offset}, extra:{message, metadata:{fix, skill}}}`):

```ts
it('allows when the only finding already existed on a shifted line', ...);   // same rule+text, BEFORE line 5, AFTER line 9
it('denies a second textually identical violation (occurrence index)', ...); // BEFORE 1x, AFTER 2x -> exactly 1 new
it('treats a whitespace-only reformat of a finding as pre-existing', ...);   // 'switch (x)  {' vs 'switch (x) {'
it('strips the config-path prefix from check_id', ...);                       // 'rules.kiko-no-switch' -> 'kiko-no-switch'
it('slices matched text from offsets, not extra.lines', ...);                 // extra.lines = 'requires login'
it('runs one semgrep process, AFTER only, when AFTER is clean', ...);        // stub call counter == 1, argv has no before/
it('runs one semgrep process over both trees when AFTER has findings', ...); // counter == 1, argv has before/ and after/
it('deny reason lists rule id, AFTER line, matched text, fix and skill', ...);
it('denies when a finding lacks metadata.skill', ...);                        // fail closed: an undocumented rule
```

- [ ] **Step 2: Run and confirm FAIL.**
- [ ] **Step 3: Implement.**
  - `runSemgrep` runs `[bin, '--metrics', 'off', '--quiet', '--json', '--disable-nosem', '--config', rulesPath, ...trees]` with `cwd: temporaryRoot`. Accept exit 0 or 1 only. Deny on a non-empty `errors[]` or on a target missing from `paths.scanned`.
  - Map results to `Finding`: tree from the path's first segment, `matchedText` = `source.slice(start.offset, end.offset)`.
  - `findingKeys` keys on `ruleId + '\0' + normalizeText(matchedText) + '\0' + occurrence`, where occurrence is the 1-based rank in file order within the same (rule, text) pair.
  - `newFindings` = AFTER keys missing from BEFORE.
  - `denyReason` prints, per finding, the five-part WHAT/DETAILS/WHY/HOW/DO-NOT text from `_lib.sh`'s `print_block`, as one string.
- [ ] **Step 4: Run and confirm PASS.**
- [ ] **Step 5: Run the file-scoped checks, then commit** `feat(harness): pre-write guard denies only findings an edit adds`.

### Task 4: Move the four Tier-1 rules into `rules/semgrep-prewrite.yml` (ONE commit)

**Role:** developer, then scribe (citations, a separate commit right after)
**Files:** Create `rules/semgrep-prewrite.yml` and `__tests__/pre-write-guard-rules.test.ts`. Modify `rules/semgrep-mobile.yml` (delete `kiko-no-switch` at line 227, `kiko-no-nullable-map-ternary` at line 262, `kiko-no-use-animated-keyboard` at line 320, and `kiko-no-history-id-comment` at line 364, each WITH its preceding comment block), `scripts/checks/security.sh` (3 semgrep invocations + the dedup fingerprint `shasum` list), and `scripts/checks/semgrep-rules.sh` (1 invocation + the two messages that name `semgrep-mobile.yml`).

- [ ] **Step 1: Record the baseline.** Run `semgrep --metrics off --quiet --json --config rules/semgrep-mobile.yml rules/fixtures src App.tsx __tests__ e2e | node -e '<print sorted check_id:path:line>' > <scratchpad>/before-move.txt`, and do the same for `npm run check:rules` and `npm run check:security` (both green).
- [ ] **Step 2: Write the failing test** `__tests__/pre-write-guard-rules.test.ts`, using real Semgrep (skip with a clear failure, not a silent pass, when `semgrep` is missing: `expect(which semgrep).toBe(0)`). For each moved rule id, feed the guard a `Write` of that rule's `.bad.ts` fixture content targeted at `src/probe/<rule-id>.ts` (in a temp `CLAUDE_PROJECT_DIR`, not under `rules/fixtures`). Assert status 2 and a reason containing the rule id. Then feed the `.good.ts` fixture content and assert status 0. Run it and confirm FAIL: `rules/semgrep-prewrite.yml` is missing.
- [ ] **Step 3: Move.** Cut the four bodies verbatim into `rules/semgrep-prewrite.yml` (header comment: its role, and the fact that the guard loads ONLY this file). Add `metadata: { fix: ..., skill: ... }` to each and change nothing else. Fix the now-dangling "unlike the Hermes TextDecoder rule above" wording in the nullable-map comment. Add `--config "$ROOT/rules/semgrep-prewrite.yml"` next to every `--config "$ROOT/rules/semgrep-mobile.yml"` in `security.sh` (lines 47, 83, 99) and `semgrep-rules.sh` (line 72). Add `shasum "$ROOT/rules/semgrep-prewrite.yml"` to `security.sh`'s fingerprint. Run `grep -rn "semgrep-mobile.yml" scripts/ harness/ package.json Makefile` and update any other loader the same way.
- [ ] **Step 4: Prove coverage is unchanged.** Re-run the Step 1 command with both configs. `diff` against `before-move.txt` must be empty, apart from `check_id` prefixes (`rules.` stays the same). `npm run check:rules` and `npm run check:security` are green. `npx jest __tests__/pre-write-guard-rules.test.ts __tests__/security-fixtures-scope.test.ts __tests__/lint-fixtures-scope.test.ts` passes.
- [ ] **Step 5: Commit** (developer) `refactor(rules): move the four pre-write rules into semgrep-prewrite.yml`. Note the empty diff in the body.
- [ ] **Step 6: scribe** updates every citation that now names the wrong file. Run `grep -rln "kiko-no-switch\|kiko-no-nullable-map-ternary\|kiko-no-use-animated-keyboard\|kiko-no-history-id-comment" .claude/skills harness/kiko docs/harness` and fix only the location references. The hits are `kiko-code-style`, `kiko-linter`, `kiko-architecture:1152`, `kiko-gestures:77`, `harness/kiko/agents/reviewer.md`, and `docs/harness/review-to-biome-inventory.md`. Commit `docs(skills): cite semgrep-prewrite.yml for the moved rules`.

### Task 5: Node checks for rules 4, 5, 6 in the guard

**Role:** developer
**Files:** Modify `scripts/checks/pre-write-guard.js` and `__tests__/pre-write-guard.test.ts`.

- [ ] **Step 1: Write the failing tests.** Use real checkers, stub Semgrep clean:

```ts
it('denies an edit that breaks import order (kiko-import-order)', ...);
it('allows an unrelated edit in a file whose import order was already broken', ...);
it('denies a new abbreviated identifier (kiko-full-word-identifiers)', ...);  // `const msg = ...`
it('honors full-word-identifiers EXEMPTIONS by path suffix', ...);             // src/db/run-migrations.ts `idx` entry
it('denies a second exported component in a .tsx (kiko-one-component-per-file)', ...);
it('does not run the component check on a .ts file', ...);
it('denies when a Node checker exits with a code other than 0 or 1', ...);     // KIKO_PREWRITE_NODE_BIN seam -> stub exit 3
```

- [ ] **Step 2: Run and confirm FAIL.**
- [ ] **Step 3: Implement `runNodeChecks`.**
  - Spawn `node import-order.js <file>`: exit 1 means parse the `  <violation>` lines (line 1, matched text = the violation). Any other nonzero code throws.
  - Spawn `node full-word-identifiers.js <file>`: parse `<path>:<line>: \`<name>\` — ... \`<word>\``, with matched text = `<name>`.
  - Rule 6 (`.tsx` only): in-process `await import(pathToFileURL(ROOT + '/scripts/checks/one-component-per-file.ts'))`. `exportedComponentNames(source)` returning more than one name gives one finding per name after the first, at the line of its `export` declaration.
  - AFTER first. The BEFORE tree is checked only when AFTER has findings, matching Task 3.
- [ ] **Step 4: Run and confirm PASS.** **Step 5: Run the file-scoped checks, then commit** `feat(harness): pre-write guard runs import-order, full-words, one-component`.

### Task 6: Rule 11 checker/fixer `blank-line-separation.js` (guard mode only)

**Role:** developer
**Files:** Create `scripts/checks/blank-line-separation.js`, `scripts/checks/blank-line-separation.sh` (per-file and project-wide modes, the `import-order.sh` shape, with a `BLANK_LINE_SOURCE_ROOT` test seam), and `__tests__/blank-line-separation.test.ts`. Modify `pre-write-guard.js`, `knip.json`, and `docs/harness/documented-exceptions.md`. Not yet in `check:all` (Task 19).

- [ ] **Step 1: Write the failing tests** (spawn the `.sh` against temp files, the `__tests__/import-order.test.ts` pattern):

```ts
it('flags return/if/for/while preceded by a non-blank line', ...);
it('does not flag the first statement of a block', ...);           // directly after `{`
it('does not flag a statement preceded by a comment line', ...);   // comment already separates
it('ignores return/if text inside strings, templates, comments, regex', ...); // blankNoise first
it('flags two adjacent JSX siblings with no blank line', ...);
it('does not flag an only-two-children pair or a comment-separated pair', ...);
it('--write inserts the blank lines and re-checks to zero', ...);
it('prints <path>:<line>: <kind>: <trimmed statement>', ...);
```

Also add a guard test: `denies an edit that adds a return with no blank line above (kiko-blank-line-separation)`.

- [ ] **Step 2: Run and confirm FAIL.**
- [ ] **Step 3: Implement.** Use the same `blankNoise`-then-scan shape as `full-word-identifiers.js`, then wire it into `runNodeChecks` (matched text = the trimmed statement line).
- [ ] **Step 4: Run and confirm PASS.** `npx jest __tests__/blank-line-separation.test.ts __tests__/pre-write-guard.test.ts`
- [ ] **Step 5: Run the file-scoped checks** (lint, full-words, import-order on the new files, `npm run check:knip`), then **commit** `feat(harness): blank-line-separation checker for the pre-write guard`.

### Task 7: Override protocol in the guard

**Role:** developer
**Files:** Modify `scripts/checks/pre-write-guard.js` and `__tests__/pre-write-guard.test.ts`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('allows a new finding with `// nosemgrep: <id> OVERRIDE(reason) why` on the line above', ...);
it('allows a new finding with the override on the same line', ...);
it('denies a new finding under a bare `// nosemgrep: <id>`', ...);           // reason names the bare override
it('denies an override naming a different rule id', ...);
it('allows a Node-rule finding with `// kiko-override: kiko-import-order OVERRIDE(...) why`', ...);
it('denies a bare `// kiko-override: <id>`', ...);
it('denies when an edit deletes a justified override that suppressed a BEFORE finding', ...); // Review Focus 5
```

- [ ] **Step 2: Run and confirm FAIL.**
- [ ] **Step 3: Implement `overrideState`.** Look for `(nosemgrep|kiko-override):\s*<ruleId>\b.*OVERRIDE\(` on the finding line or the line above. Drop `justified` findings from BOTH trees before the diff. A `bare` override on an AFTER finding is itself a deny reason. Semgrep runs with `--disable-nosem` (Task 3), so the guard alone decides and a bare `nosemgrep` never silently suppresses.
- [ ] **Step 4: Run and confirm PASS.** **Step 5: Commit** `feat(harness): pre-write guard override protocol`.

### Task 8: `override-guard.sh` rejects bare `nosemgrep:` / `kiko-override:`

**Role:** developer
**Files:** Modify `scripts/checks/override-guard.sh`. Create `__tests__/override-guard.test.ts`.

- [ ] **Step 1: Write the failing tests** (temp files passed as args):

```ts
it('fails a bare // nosemgrep: <id>', ...);
it('fails a bare // kiko-override: <id>', ...);
it('passes both forms when OVERRIDE(...) is present', ...);
it('still fails a bare biome-ignore', ...);
it('passes scripts/checks/pre-write-guard.js itself', ...);  // its regex text must not self-match
```

- [ ] **Step 2: Run and confirm FAIL.**
- [ ] **Step 3: Implement.** Extend the `grep -nE` to `biome-ignore|//\s*(nosemgrep|kiko-override):` and update the `print_block` text to name all three forms.
- [ ] **Step 4: Run and confirm PASS.** Also run `npm run check:overrides` (project-wide, green).
- [ ] **Step 5: Commit** `feat(harness): override guard covers nosemgrep and kiko-override`.

---

**Tier 2 and Tier 3 Semgrep rule tasks (9-16): the shared TDD loop.** Rule 12 (Task 18) is a Node check and has its own steps. Each task follows the same steps. The rule-specific parts are listed in each task.

1. Write the fixture pair `rules/fixtures/<rule-id>.bad.ts(x)` (with `// EXPECT-FINDING` above each pinned line) and `.good.ts(x)` (it follows every rule; see Global Constraints). Add one guard case per new rule to `__tests__/pre-write-guard-rules.test.ts`.
2. `npm run check:rules`: expect FAIL, "rule `<id>` reported NOTHING on its positive fixture".
3. Add the rule to `rules/semgrep-prewrite.yml`: `severity: ERROR`, `metadata.fix`, `metadata.skill`, and every `:`-bearing pattern YAML-quoted (kiko-linter "Semgrep facts").
4. `npm run check:rules`, then `npx jest __tests__/pre-write-guard-rules.test.ts`: PASS.
5. List the sweep with `semgrep --metrics off --quiet --config rules/semgrep-prewrite.yml src App.tsx __tests__ e2e`, fix each hit at its source, and repeat until empty.
6. Run the file-scoped checks on every touched file: `bash scripts/checks/lint.sh <f>`, `semgrep --metrics off --config rules/semgrep-mobile.yml --config rules/semgrep-prewrite.yml <files>`, `node scripts/checks/full-word-identifiers.js <files>`, `node scripts/checks/import-order.js <files>`, `bash scripts/checks/dup.sh <changed files>`, and `npx jest <affected tests>`. Then run `npm run check:security` and `npm run check:import-order`.
7. Commit the rule, fixtures, and sweep together as `feat(rules): <rule-id> (+ sweep)`.
8. Add a `docs/harness/review-to-biome-inventory.md` row in the same commit (kiko-linter "Every mechanized finding gets an inventory row").

### Task 9: Rule 8 — `kiko-no-raw-color-literal`

**Role:** developer
**Rule:** a string literal matching `^#[0-9A-Fa-f]{3,8}$` or `^rgba?\(`. `paths.exclude`: `src/design-system/palette.ts`, `src/design-system/theme.ts`, `*.test.ts`, `*.test.tsx` (deviation 4). Use `pattern-regex` anchored on a quoted literal, or an AST `"'$COLOR'"` + `metavariable-regex`, so comments are never matched. Many comment-only mentions exist in `theme.ts`, `symbol.color.ts`, and `bottom-sheet.styles.ts:159`. A fixture line with a hex in a comment must stay silent in `.good.ts`.
**Known sweep:** `src/navigation/dark-theme.ts:18-22` (reference `theme.colors.*` tokens) and `src/data-transfer/snapshot/restore-snapshot.ts:107` (`'#5E5CE6'`: use or add a palette token). Confirm the full list with shared-loop step 5.
**skill:** `kiko-design-system › Token categories`.

### Task 10: Rule 9 — `kiko-glass-surface-nav-layer-only`

**Role:** developer
**Rule:** an import from a path ending `glass-surface` (`pattern-regex: import\s[^;]*from\s*['"][^'"]*glass-surface['"]`). The nav-layer allowlist is a `paths.exclude` list kept in the rule, with a comment saying "extend this list for a new nav-layer surface". Start it from today's importers:
- `src/design-system/components/glass-surface/**`
- `src/design-system/components/bottom-sheet/**`
- `src/design-system/components/keyboard-done-accessory/**`
- `src/screens/home/add-transaction-fab/**`

`paths.exclude` is safe to path-prefix (kiko-linter). The good fixture imports `Card` from a `card` path.
**Sweep:** `src/screens/settings/settings-row/settings-row.component.test.tsx` references `glass-surface`. Read it: a `jest.mock('…glass-surface')` string is not an `import` and does not match. A real import there is a real finding, so fix the test to use `Card`/the settings-row's real surface, or justify it with an override. Do not widen the rule.
**skill:** `kiko-design-system › Component set (GlassSurface)`.

### Task 11: Rule 10 — hand-built copies of shared components (three ids)

**Role:** developer
**Rules (one fixture pair EACH, because fixture discovery is by filename):**
- `kiko-no-hand-built-divider`: `height: StyleSheet.hairlineWidth` in a style object, excluding `src/design-system/components/divider/**`. `borderWidth: StyleSheet.hairlineWidth` is a bordered field or card and must stay silent (good fixture).
- `kiko-no-raw-field-error-text`: `<Text ... variant="caption" ... tone="negative" ...>` in either prop order, excluding `src/design-system/components/field-error/**` and `field-label/**` (the required asterisk). Check `field-label` before excluding it. A `variant="body"` status line stays silent.
- `kiko-no-hand-built-selectable-row`: `<Pressable ... accessibilityState={{ selected: $S }} ...>` or `<Pressable ... accessibilityRole="checkbox" ...>`, excluding `src/design-system/components/selectable-row/**`.

**Known sweep:**
- dividers: `src/screens/home/home.styles.ts:34`, `src/screens/account-detail/account-detail.styles.ts:25`, `src/screens/holding-detail/holding-detail.screen.tsx:926`. Replace with `<Divider />` and delete the style.
- field errors: `src/screens/settings/import-data/import-data.screen.tsx:198,207,226`. Replace with `FieldError`.
- selectable rows: whatever shared-loop step 5 lists.

Update each touched screen's tests.
**skill:** `kiko-design-system › Component set`.

### Task 12: Rule 13 — literal user-facing strings in sync/provider modules (two ids + nested fixtures)

**Role:** developer
**Files (beyond the shared loop):**
- `scripts/checks/semgrep-rules.sh`: accept nested fixtures `rules/fixtures/<rule-id>/<mirrored path>/<name>.(bad|good).<ext>`. The rule id is the first directory segment. The scanned-set check compares relative paths, not basenames.
- `__tests__/semgrep-rules-nested-fixtures.test.ts`: a temp fixture dir via a new `KIKO_RULES_FIXTURES` seam proves (a) a nested bad fixture counts for its rule, (b) a nested fixture missing its pair fails, (c) a flat fixture still works.
- `.claude/skills/kiko-linter/SKILL.md` fixture contract: scribe, Task 22.

**Rules:**
- `kiko-no-literal-sync-error`: `throw new Error('...')` or `` throw new Error(`...`) `` with `paths.include: ["src/crypto-sync/**", "src/monobank/**"]` and `paths.exclude: ["*.test.ts"]`. The fixture is nested at `rules/fixtures/kiko-no-literal-sync-error/src/monobank/`. `throw new Error(i18n.t('...'))` is silent.
- `kiko-no-literal-biometric-label`: the `cancelLabel`/`fallbackLabel` property with a string literal value (`src/auth/biometrics.ts:130-131`).

**Sweep:** 19 `throw new Error(` in `src/crypto-sync` and `src/monobank` (non-test), plus the two biometric labels. Replace each with `i18n.t('<namespace>.errors.<key>')` (`i18n` is from `src/i18n/index.ts`, already imported by `src/crypto-sync/sync/sync.ts`). Add the keys to BOTH `src/i18n/locales/en.ts` and `uk.ts` (parity test `en.uk.parity.test.ts`; uk uses "Кіко", and `’` U+2019 for apostrophes). Update the tests that assert the old English literals.
**Coordinator note:** the new en/uk keys need USER translation review before any deploy that ships them.
**skill:** `kiko-code-style › Externalize hardcoded config` / `kiko-translator`.

### Task 13: Rule 14 — `kiko-no-placeholder-equal-to-label`

**Role:** developer
**Rule:** an object literal holding a `*Placeholder` key and a sibling key with the SAME string value (`{ ..., $LABEL: $VALUE, ..., $PLACEHOLDER: $VALUE, ... }` with `metavariable-regex` `$PLACEHOLDER` `.*Placeholder$`, both orders). Also a JSX element whose `placeholder=$VALUE` equals its `label=$VALUE`. If Semgrep cannot bind a repeated string metavariable in an object pattern, stop and report it (verify empirically first). Do not fall back silently.
**Sweep:** expected zero. A 2026-09-25 scan of `en.ts`/`uk.ts` found no equal pair. Confirm it.
**skill:** `kiko-design-system › Field placeholder and error copy`.

### Task 14: Rule 15 — `kiko-worklet-directive-required`

**Role:** developer
**Rule:** a call `$F(...)` inside a callback passed to `useAnimatedStyle`, `useDerivedValue`, `useAnimatedReaction`, `useAnimatedScrollHandler`, `runOnUI`, or `Gesture.$G().$ON(...)`, where the SAME file declares `$F` (a `const` arrow or a `function`) whose first statement is not `'worklet'`. Use `pattern-inside` for the file-level declaration plus `pattern-not-inside` for the `'worklet'`-first form. The heuristic keeps false negatives acceptable (spec rule 15).
- Good fixture: a `'worklet'`-tagged helper, an inline arrow, and an imported function (not flagged, a known false negative).
- Bad fixture: the `bottom-sheet.component.tsx`-style untagged helper.

**Sweep:** whatever shared-loop step 5 lists. Add `'worklet'` as the first statement.
**Also:** scribe (Task 22) moves kiko-linter's "Backlog: a rule for a plain function called inside a worklet" to implemented, and updates the inventory backlog row.
**skill:** `kiko-gestures › Every function called inside a worklet needs its own 'worklet' directive`.

### Task 15: Rule 17 — `kiko-no-undefined-nitro-prop`

**Role:** developer
**Rule:** the rule's source header lists the known Nitro props: `SFSymbolView.fallbackName`. On `<SFSymbolView ... fallbackName={$E} ...>`, flag `$E` = `undefined`, `$A ?? undefined`, `$C ? $A : undefined`, `$C ? undefined : $A`, or a bare optional prop pass-through (`fallbackName={fallbackName}` where `fallbackName` is a destructured prop). Silent: a string literal, or a value from `effectiveFallbackName(...)` (`src/design-system/components/symbol/symbol.availability.ts:38`, the pattern that `symbol.component.tsx:35-40` uses).
**Sweep:** expected zero (`symbol.component.tsx` already routes through `effectiveFallbackName`). Confirm it.
**skill:** `kiko-design-system › Component set (SymbolIcon)`.

### Task 16: Rule 16 — pinned button variants (BLOCKED: user decision, deviation 3)

**Role:** coordinator (ask the user), then developer
- [ ] **Step 0:** the coordinator gets the user's ruling on the Sync button (`primary` today, `secondaryTonal` in the spec) and the Change bank button (`ghost` today, `secondaryTonal` in the spec). The developer then re-reads `src/design-system/components/button/button.props.d.ts:21-27` and confirms the variant names.

**Rules:**
- `kiko-pinned-sync-button-variant`: a `<Button>` whose children contain `t('accountDetail.syncNow')`, with a variant other than the ruled one.
- `kiko-pinned-change-bank-button-variant`: the same for `t('accountDetail.changeBankAction')`.
- `kiko-pinned-cancel-button-style`: a `<Button>` whose child is `t('common.cancel')` without `variant="ghost"` AND `textColor={theme.colors.negative}` (the `confirm-sheet.component.tsx:60` shape).

**Sweep:**
- `bank-sync-section.component.tsx:233` (Sync) and `:318` (Change bank), plus `crypto-sync-section.component.tsx:107` (Sync), per the ruling.
- cancel sites: `card-context-menu.component.tsx:~222`, `icon-picker-modal.component.tsx:~110`, `add-category-row.component.tsx:~164`. The rule covers every sheet's Cancel. A non-sheet site the ruling excludes gets a `paths.exclude` entry with its reason in the rule comment. Do not leave it as an override.

Update the affected component tests.
**skill:** `kiko-design-system › Component set (Button)`.

### Task 17: Merge the feat tip before the conflict-heavy sweeps

**Role:** coordinator-routed, executed by developer in this worktree
- [ ] `git merge feat/assets-debts` (no checkout, no rebase of published commits). Resolve `rules/semgrep-mobile.yml` by keeping the move intact: a feat edit to a moved rule body is applied inside `rules/semgrep-prewrite.yml`. `npm install` if the merge changed `package-lock.json`.
- [ ] Re-run shared-loop step 5 for every rule from Tasks 9-16, and fix any new hit the feat code introduced.
- [ ] `npm run check:rules && npm run check:security && npx jest`. Commit the merge, then the fix-ups as `fix(rules): sweep feat-track hits for the pre-write rules`.

### Task 18: Rule 12 — `kiko-no-cross-screen-import` (Node check + project gate + sweep)

**Role:** developer
**Files:** Create `scripts/checks/screen-imports.js`, `scripts/checks/screen-imports.sh` (per-file + project-wide, `SCREEN_IMPORTS_SOURCE_ROOT` seam), and `__tests__/screen-imports.test.ts`. Modify `pre-write-guard.js` (`runNodeChecks`), `package.json` (`check:screen-imports`, added to `check:all` before `check:typecheck`), `knip.json`, and `docs/harness/documented-exceptions.md`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('flags src/screens/a/x.tsx importing ../../b/y', ...);
it('flags an @kiko/screens/b/... alias import from screen a', ...);
it('allows imports within the same screen folder at any depth', ...);
it('allows imports from outside src/screens', ...);
it('ignores import text inside comments and strings', ...);
it('prints <path>:<line>: <specifier>', ...);
```

Plus a guard case: `denies an edit that adds a cross-screen import`.
- [ ] **Step 2: Run and confirm FAIL.** **Step 3: Implement** by resolving each relative specifier with `path.resolve(path.dirname(file), specifier)` against the mirrored root and comparing `src/screens/<segment>`. **Step 4: Run and confirm PASS.**
- [ ] **Step 5: Sweep (same commit).** 30 imports of 17 modules on 2026-09-25. List them with `bash scripts/checks/screen-imports.sh` (project-wide). Move each shared module out of `src/screens/` into `src/design-system/components/` (a UI component) or the owning domain module (a hook or helper), following the `FieldTrigger` precedent in `kiko-design-system`. Update every importer and co-located test. A moved module must not import from `src/screens/**`, or `kiko-no-import-screens-outside-ui` fires. The modules:
  - `entity-header-icon`, `entity-amount-header`
  - `statistics/use-focus-refreshed-now`
  - `forms/scroll-to-field`, `forms/color-picker`, `forms/holding-identity-field`, `forms/use-submit-once`
  - `statement-import/{import-result-sheet,preview-stats,use-target-holding-options,example-transaction}`
  - `account-detail/{crypto-sync-form,monobank-connect-field,clipboard-text-field}`
  - `home/{transaction-row,filter-menu,date-range-field}`

  If a module is really screen-owned and only mis-placed, move the importer instead. Record each choice in the commit body.
- [ ] **Step 6: Verify.** `npm run check:screen-imports`, `npm run check:security` (the screens-outside rule), `npm run check:knip`, `npm run check:typecheck`, `npm run check:import-order`, `bash scripts/checks/dup.sh <changed files>`, `npx jest` (full, because the moves are cross-file). **Commit** `feat(harness): kiko-no-cross-screen-import (+ move shared screen modules)`.

### Task 19: Rule 11 sweep + project gate

**Role:** developer
**Files:** Modify `package.json` (`check:blank-line-separation` in `check:all`) and every file the fixer changes.
- [ ] `node scripts/checks/blank-line-separation.js --write $(find src __tests__ e2e -name '*.ts' -o -name '*.tsx') App.tsx`. Hand-fix whatever it reports as `left for hand fix`.
- [ ] `npm run check:blank-line-separation` (green), `npm run check:lint` (Biome keeps the inserted blank lines), `npx jest` (full).
- [ ] **Commit** `style: apply blank-line separation (+ check:blank-line-separation gate)`. The body holds the exact fixer command, so a later conflict is resolved by re-running it.

### Task 20: Speed measurement

**Role:** developer (measure), ops (if a long run is needed)
- [ ] Measure 20 guard runs each on real files, with real Semgrep:
  - (a) clean one-line `Edit` in `src/design-system/components/button/button.component.tsx`
  - (b) same in `src/screens/forms/transaction-form/transaction-form.screen.tsx` (about 2500 lines)
  - (c) an `Edit` adding a `switch` to (a), which runs both trees
  - (d) a `Write` of a new `.tsx`

  Command: `for run in $(seq 20); do /usr/bin/time -p bash scripts/checks/pre-write-guard.sh < <payload>.json 2>&1 >/dev/null | awk '/real/{print $2}'; done | sort -n`. Build each payload with `node -e` (`CLAUDE_PROJECT_DIR=$PWD`). Report p50 = 10th and p95 = 19th value.
- [ ] If any p95 is 3 s or more, apply the spec's mitigation only: parse the rules once per invocation and reuse the parsed form. Semgrep 1.175 has no persistent rule cache flag other than the existing `--metrics off`, so first probe `semgrep --help` for a rule-cache option, and never start a daemon. If still over, report the numbers to the coordinator. Do not loosen the target.
- [ ] Put the p50/p95 table in the commit body. **Commit** `perf(harness): measure pre-write guard latency`, together with any mitigation code and its tests.

### Task 21: `hooks.json` wiring (branch AND a separate commit on main)

**Role:** developer (branch); coordinator-routed (main)
- [ ] Branch: add the spec's `PreToolUse` entry for `Edit|Write|MultiEdit` to `harness/kiko/hooks/hooks.json`, next to the existing `Bash` matcher, byte-for-byte as in the spec's "Trigger and wiring" block (`timeout: 30`). Add a test to `__tests__/pre-write-guard.test.ts` that parses `hooks.json`, asserts both `PreToolUse` matchers exist, and runs the entry's `command` string via `bash -c` with `CLAUDE_PROJECT_DIR` set to (1) a temp dir with no script (exit 0, no output) and (2) the repo (it reaches the guard). Commit `feat(harness): wire the pre-write guard on PreToolUse`.
- [ ] **Main (coordinator-routed, separate tiny commit):** the plugin installs from `main`, so the coordinator lands the SAME `hooks.json` change on `main` as its own commit (`git cherry-pick <branch sha>`, touching only `harness/kiko/hooks/hooks.json`). The identical change lets the later `feat/assets-debts` → `main` merge resolve cleanly. It is safe before the script reaches `main` because of `[ -f "$f" ] || exit 0`. Do not push unless the coordinator says so.

### Task 22: Docs + end gate

**Role:** scribe (docs), then ops (`make verify`), then coordinator (`make deep`)
- [ ] **scribe:**
  - `CLAUDE.md`: a new checks-table row (pre-write guard, `PreToolUse` `Edit|Write|MultiEdit`, "any NEW finding from the 17 rules denies the write"); `check:rules`/`check:security` rows naming both yml files; the `check:all` list (add import-order, full-word-identifiers, blank-line-separation, screen-imports); the "Automatic wiring" paragraph (the new `PreToolUse` matcher beside `kill-guard.sh`, its no-op-when-absent guard, fail-closed).
  - `docs/harness/documented-exceptions.md`: the `nosemgrep`/`kiko-override` forms and every exclude added in Tasks 9-16.
  - `.claude/skills/kiko-linter/SKILL.md`: a THIRD wrapper-contract exception for the pre-write guard (denies with exit 2 + deny JSON; no dedup; fail-closed; env seams); `semgrep-prewrite.yml` vs `semgrep-mobile.yml` placement; nested fixtures; `metadata.fix`/`metadata.skill`; the Semgrep facts verified on 2026-09-25 (unanchored path patterns across roots, `extra.lines` = "requires login", `nosemgrep` with trailing text honored); the worklet backlog marked implemented.
  - `harness/kiko/skills/harness-workflow/SKILL.md`: "A write can be denied before it lands", with how to read the deny, the override form, and "never retry the same write unchanged".
  - `kiko-code-style` blank-line and JSX-sibling sections: "now mechanized".
  - Commit `docs(harness): document the pre-write guard`.
- [ ] **ops:** `make verify`, run until green. Fix a failure at its source through the developer.
- [ ] **coordinator:** `KIKO_MUTATION_BASE=feat/assets-debts make deep`, run detached and awaiting only the exit code. The Task 18/19 sweeps inflate the changed-file set, so expect a large mutant count (the ETA prints live). Effectively green = mutation ≥ threshold and osv reporting only the known CVE set.

### Task 23: Whole-branch review

**Role:** reviewer (kiko:reviewer)
- [ ] The coordinator first merges the feat tip again (Task 17 procedure, `rules/semgrep-mobile.yml` diffed explicitly). Then `/ponytail-review` plus the correctness, conventions, and compliance pass over `git diff feat/assets-debts...pre-write-guard`. Focus on the Review Focus list, the spec deviations, fail-closed paths, and that no check was weakened. The developer fixes findings. Re-run `make verify`.

### Task 24: Drift pass

**Role:** retrospect, then scribe
- [ ] `kiko:retrospect` checks `.claude/skills/`, `harness/kiko/skills/`, and `harness/kiko/agents/` against the branch. `kiko:scribe` fixes and commits. The report names the drift-fix sha or states "no drift found".

### Task 25: Rollout checklist (coordinator)

- [ ] `hooks.json` commit on `main` (Task 21) landed.
- [ ] Merge `pre-write-guard` into `feat/assets-debts` at a clean boundary (no in-flight edit in either worktree); `git diff` `rules/semgrep-mobile.yml` and `rules/semgrep-prewrite.yml` after the merge; `make verify` on `feat/assets-debts`.
- [ ] The user updates the `kiko` plugin and runs `/reload-plugins` in every running session.
- [ ] Smoke: in the feat worktree, one agent `Edit` that adds a `switch` to a scratch `.ts` must be denied; the same edit with `// nosemgrep: kiko-no-switch OVERRIDE(smoke) smoke test` proceeds. Delete the scratch file.
- [ ] Message the PM (milestone). Prune the `pre-write-guard` worktree once integrated.
- [ ] Before any deploy that ships the Task 12 keys: user translation review of the new en/uk keys.
