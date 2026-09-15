# Kiko quality harness

This project uses a Biome-adapted, LLM-guarding quality harness. Every
check runs through a wrapper in `scripts/checks/` that prints a
structured failure block on failure and stays silent on success.

**Standing rule: fix the underlying issue. Never weaken a check to get
green.** No `|| true`. No global auto-suppress. An ignore-list entry
needs a concrete, specific justification (see "Documented exceptions"
below).

## Checks

| Command | Tool | Threshold | Tier |
|---|---|---|---|
| `npm run check:lint` | Biome | any lint/format violation fails | fast (PostToolUse) |
| `npm run check:dup` | jscpd | >5% duplicated lines/tokens fails | medium (Stop/SubagentStop) |
| `npm run check:knip` | Knip | any unused file/export/dependency fails | medium |
| `npm run check:deps` | depcheck + `npm ci --dry-run` | any unused/missing dep, or broken lockfile, fails; a changed dependency block is surfaced for confirmation | medium |
| `npm run check:security` | Semgrep (`p/typescript`, `p/react`, `p/secrets`, `rules/semgrep-mobile.yml`) | any Class A (ERROR) finding fails; Class B (WARNING) findings are surfaced, override-eligible, non-blocking | fast |
| `npm run check:rules` | `scripts/checks/semgrep-rules.sh` — Semgrep (`rules/semgrep-mobile.yml`) against `rules/fixtures/` | for every fixture present: a rule that reports nothing on its positive fixture, misses a line pinned there by an `EXPECT-FINDING` comment, or matches its negative one fails; so does a fixture id with only one half of its pair present, and a scan that proved nothing (no fixtures, a fixture semgrep never opened, a semgrep error, or a semgrep/verifier crash). A rule with no fixture at all is not detected here — the fixture set is the input | medium |
| `npm run check:plist` | plist.sh (`plutil`) | any Info.plist security invariant violation fails | medium |
| `npm run check:secrets` | gitleaks | any detected secret fails | fast |
| `npm run check:overrides` | override-guard.sh | any bare `biome-ignore` (no `OVERRIDE(...)`) fails | medium |
| `npm run check:typecheck` | tsc (`--noEmit`) | any type error fails | medium |
| `npm run check:mutation` | Stryker (Jest runner) | mutation score below 60 (break threshold; ratchet up over time) fails | deep only |
| `bash scripts/checks/osv.sh` | osv-scanner | any known CVE in `package-lock.json` fails | deep only |
| `npm run check:screenshots` | Maestro (`.maestro/regression.yaml`, RICH scenario) + pixelmatch (`scripts/checks/screenshot-diff/compare-png.js`), diffed against the STABLE-glass `screenshots/regression/6.9-inch/uk/` baseline (NOT the marketing `screenshots/appstore/...` set) | any captured image's per-pixel mismatch ratio over 0.5% (`maxMismatchRatio`) at pixelmatch `threshold` 0.1 fails; so does a missing baseline, a missing captured file, a Maestro run that fails or captures zero PNGs, or `maestro` missing from PATH | deep/manual only — needs a booted, pinned simulator with the RICH-scenario STABLE-glass screenshot-mode build (`ENVFILE=.env.screenshots.stable`) already installed (ops), so it is NOT in `check:all`/`check:deep` and NOT hook-wired |
| `npm run check:screenshots:empty` | Same engine as `check:screenshots` (`scripts/checks/screenshots.sh`, scenario env vars set by the `scripts/checks/screenshots-empty.sh` wrapper), running `.maestro/regression-empty.yaml` against the `screenshots/regression-empty/6.9-inch/uk/` baseline | same thresholds/fail-closed guards as `check:screenshots` | deep/manual only — needs the EMPTY-scenario STABLE-glass build (`ENVFILE=.env.screenshots.empty.stable`) installed (ops); not in `check:all`/`check:deep`, not hook-wired |
| `npm run check:screenshots:locked` | Same engine as `check:screenshots` (`scripts/checks/screenshots-locked.sh` wrapper), running `.maestro/regression-locked.yaml` (the single app-lock gate frame) against `screenshots/regression-locked/6.9-inch/uk/` | same thresholds/fail-closed guards as `check:screenshots` | deep/manual only — needs the LOCKED-scenario STABLE-glass build (`ENVFILE=.env.screenshots.locked.stable`) installed (ops); not in `check:all`/`check:deep`, not hook-wired |

Composite scripts:

- `npm run check:all` — the fast + medium tier checks, in order:
  lint, dup, knip, deps, security, rules, plist, secrets, overrides,
  typecheck.
- `npm run check:deep` — the heavy tier: mutation testing, then
  osv-scanner. **Run this before declaring a feature done.** It is not
  wired to any hook because it is slow; it is a manual checkpoint. By
  default the mutation step mutates ONLY the source files changed
  against the merge-base with `${KIKO_MUTATION_BASE:-main}`
  (tests/fixtures excluded); set `KIKO_MUTATION_FULL=1` to force a
  whole-project run. The mutation step tees its output to a stable,
  tailable progress log and prints an ETA from run history — a
  per-mutant rate (seconds/mutant) derived from past runs, times this
  run's actual mutant count, printed live the moment Stryker reports
  that count — for a human to watch directly; agents still must not poll
  it — the exit code remains the only signal. See the `kiko-linter`
  skill.

Automatic wiring (`harness/kiko/hooks/hooks.json`, via the
`kiko` plugin — see "Harness agents" below): the fast tier
(`scripts/checks/fast.sh`: lint, security, secrets on the touched
file) runs on `PostToolUse` for `Edit|Write|MultiEdit`. The medium
tier (`scripts/checks/medium.sh`: dup, override-guard scoped to the
session's changed source files; knip, deps, the Semgrep rule
fixtures, the Info.plist security assertions, and typecheck
project-wide) runs on `Stop` and `SubagentStop`, and stays silent
only when the session changed neither a source file nor a harness
input — a rule `.yml`, a file under `rules/fixtures/`, a wrapper in
`scripts/checks/`, or `ios/Kiko/Info.plist`. A session that edited
only a rule, a fixture, or the plist is the one most likely to have
broken a rule (or unpinned a credential-bearing host), so it must not
be the one that runs nothing. `tsc --noEmit` is project-wide by
nature — a type error surfaces in the file that CONSUMES a changed
type, not only in the file that was edited — so it never takes a
changed-file argument. Both wrappers exit `2` on failure and print
the structured block to stderr, which is how Claude Code surfaces the
failure back to the agent. A fresh checkout must run `npm install`
before these hooks work — every wrapper's tool lives in
`node_modules`.

**Content dedup (a check skips when its inputs did not change).**
`Stop` and `SubagentStop` both call the medium tier, so a
subagent-driven session runs it once per finished subagent plus once
for the coordinator; a developer agent also re-ran `check:deep` after
only an icon asset was added. To stop these duplicate runs, every check
records a fingerprint of its own real inputs when it passes, and skips
the next run whose fingerprint is identical (helpers in
`scripts/checks/_lib.sh`). The fast tier fingerprints the single target
file plus its config and tool version; `dup` and `override-guard`
fingerprint the changed-file set; `knip`, `deps`, and `mutation`
fingerprint the `.ts/.tsx/.js` source state relative to `HEAD` plus the
manifests and configs (so a non-source change — an icon asset, an
`ios/` file, a doc — skips them). `medium.sh` also holds a per-worktree
single-flight lock so parallel `SubagentStop`/`Stop` runs do not launch
concurrent `knip`/`deps`/`jscpd`; `mutation.sh` holds a GLOBAL
(machine-wide) single-flight lock at a fixed path NOT keyed by the
worktree, so only one Stryker can run at a time across all worktrees —
if a live run already holds it, a second run fails fast (exit 2) with a
block naming the holding pid and worktree rather than blocking or
queueing, and the lock is released on normal exit and on INT/TERM via a
trap so a killed run never strands it. Stryker's own `concurrency` is
2. The fingerprint state lives
outside the repo, keyed by the worktree path, and is shared across
sessions in that worktree — one session's pass lets another skip. A
skip is recorded only on a PASS, so a failing check always re-runs.
`osv-scanner` is deliberately never deduped: its result depends on the
external vulnerability database, which changes even when the lockfile
does not.


### `check:screenshots` (App Store screenshot visual regression)

The screenshot visual-regression checks (`check:screenshots` and its
`:empty` / `:locked` siblings, and the separate marketing capture flow)
are documented IN FULL in **`docs/harness/screenshots-check.md`** —
marketing-vs-regression split, the 3 scenarios and their baselines, the
stable-glass build requirement, the Maestro 2.10.0 path constraint, and
the pixelmatch tolerances. Read that file before you touch any
`.maestro/*regression*.yaml` flow, `scripts/checks/screenshots*.sh`,
`scripts/checks/screenshot-diff/*`, or a `screenshots/regression*/`
baseline. These checks are deep/manual only — not in
`check:all`/`check:deep`, not hook-wired.

## Override protocol

A Biome lint rule may only be suppressed with a justified override —
never a bare `biome-ignore`:

```ts
// biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(third-party boundary) the vendor SDK returns an untyped payload here
const raw: any = sdk.rawResponse();
```

`npm run check:overrides` fails on any `biome-ignore` comment that
does not contain `OVERRIDE(...)`. Do not delete the guard or move a
suppressed pattern elsewhere to dodge it — either justify the
override with a specific reason, or fix the code so the ignore is not
needed at all.

The same principle applies to every other ignore-list style
exception in this repo (see "Documented exceptions" below): a
suppression is only acceptable when it names a concrete reason a
human or agent can verify.

## Documented exceptions

Every ignore-list / suppression exception in this repo is a real, verified
usage with a concrete justification — not dead weight. The full inventory
(`knip.json`, `tsconfig.json` `types`, `.depcheckrc.json`, `.gitleaks.toml`,
`.jscpd.json`, `rules/fixtures/**`, the Stryker mutate-set and sandbox
exclusions, `.npmrc` `min-release-age-exclude`, and the `check:screenshots`
diff exclusions) lives in **`docs/harness/documented-exceptions.md`**. Read
and UPDATE that file when you add, change, or rely on an exception. The
standing rule holds: a suppression is acceptable only when it names a
concrete reason a human or agent can verify (see "Override protocol" above).

## Dependency hygiene

`.npmrc` enforces a 7-day dependency minimum age:

```
min-release-age=7
min-release-age-exclude[]=Kiko
min-release-age-exclude[]=react-native
```

Note for anyone editing this: the real npm 11 config keys are
`min-release-age` (a plain number of **days**) and
`min-release-age-exclude`. `minimum-release-age` /
`minimum-release-age-exclude[]` are **not** recognized keys — npm
silently warns "Unknown project config" and enforces nothing. This
was verified against the npm CLI's own config definitions and by
testing: a version published 2 days ago was blocked; a years-old
version installed normally.

This requires npm 11.10+. Global npm on this machine was upgraded
(user-approved) from 10.9.3 to 11.19.1 to enable it.

`check:deep`'s osv-scanner step previously failed on 6 known CVEs in
transitive dev dependencies pulled in by the React Native CLI
toolchain (`@babel/core`, `ajv`, `image-size`, `tmp`). Four had a
patched version available and are now remediated via the
`overrides` block in `package.json` (`@babel/core`, `ajv`, `tmp`);
two (in `image-size`) do not yet — see "Known dependency CVEs"
below. This is tracked, real risk, not a harness bug — do not
suppress it.

`check:deep`'s osv-scanner also flagged CVE GHSA-67mh-4wv8-2f99:
esbuild <0.25.0, pulled in transitively by drizzle-kit's deprecated
`@esbuild-kit/core-utils`. Same pattern as the other three: pinned
via the `overrides` block in `package.json` to `^0.25.12`.

### `.env` is public-only

`react-native-dotenv` inlines every `.env` value into the JS bundle at
build time, so anything placed there ships in plaintext to every device.
Only public, non-secret values (a public API URL, a feature flag) belong
in `.env`. Secrets live in the iOS Keychain (`react-native-keychain`),
never in `.env`, `.env.local`, the database, or a log.

`.env` is not tracked; only the public `.env.example` template is. The
`postinstall` step (`scripts/ensure-env.js`) copies `.env.example` to
`.env` automatically when `.env` is missing, so a fresh checkout,
worktree, or CI has a working `.env` with no manual step. It never
overwrites an existing `.env`, so a hand-edited file or a `.env.local`
override survives `npm install`.

### Known dependency CVEs

`check:deep` will continue to flag 2 `image-size` advisories
(GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) at version 1.2.1, a
transitive dev dependency of the React Native CLI toolchain. No
patched release exists upstream yet, so there is nothing to pin via
`overrides`. This is accepted debt, not a suppressed finding — do
not silence it. Re-run `npm run check:deep` periodically and upgrade
`image-size` (via `overrides`) the moment a fixed version ships.

`check:deep` also flags `decode-uri-component` 0.2.2, advisory
GHSA-vcc3-ghjq-m6fr (CVSS 6.6), pulled transitively via
`@react-navigation/native` -> `@react-navigation/core` ->
`query-string` -> `decode-uri-component`. The fixed release (0.5.0)
is ESM-only and breaks `query-string@7.1.3` (CommonJS) and Jest, so
it cannot be pinned via `overrides` today. Accepted as tracked debt,
same class as the `image-size` CVEs above — do not suppress it;
re-check periodically and pin once `query-string` ships an
ESM-compatible or patched line.

## Future stubs (disabled — do not enable without discussion)

```bash
# FUTURE (disabled): a pre-commit hook could run `npm run check:all`.
# FUTURE (disabled): a CI job could run `npm run check:all` and `npm run check:deep` as required checks.
```

## Harness agents

The Kiko agent harness is a local Claude Code plugin at
`harness/kiko/` (`kiko` in the local
`harness/.claude-plugin/marketplace.json`). It ships twelve role agents,
five project skills (four thin-wrap superpowers, plus a `release`
skill that documents the release-publishing workflow), one vendored
review command, and the tier hooks documented above.

A fresh checkout must run `npm install` before the harness hooks
work — the check tools they call (Biome, jscpd, Knip, depcheck,
Stryker) live in `node_modules`; `semgrep` and `gitleaks` are resolved
from `PATH` instead.

### Delegation rule

The coordinator delegates all work to these agents and never edits
app files inline. Complex or parallel work is split into separate
Orca worktrees. If no agent fits a task, the coordinator reports the
gap — it does not do the task itself.

### The twelve agents

| Agent | Role | model | effort | Spawn command |
|---|---|---|---|---|
| developer | Writes all TypeScript/React Native code | sonnet | high | `claude --agent developer --effort high` |
| planner | Writes implementation plans from a spec or feature request | sonnet | medium | `claude --agent planner --effort medium` |
| debugger | Isolates faults, writes no code | sonnet | high | `claude --agent debugger --effort high` |
| reviewer | Reviews diffs: correctness, project conventions, then ponytail over-engineering findings | sonnet | high | `claude --agent reviewer --effort high` |
| qa | Writes Jest/RNTL unit tests and Maestro E2E flows | sonnet | high | `claude --agent qa --effort high` |
| designer | Owns theme tokens and shared styled components | sonnet | high | `claude --agent designer --effort high` |
| explorer | Read-only codebase search | sonnet | medium | `claude --agent explorer --effort medium` |
| retrospect | Gathers durable lessons after a run | sonnet | medium | `claude --agent retrospect --effort medium` |
| scribe | Persists durable knowledge (memory, skills, agents, plugin) | sonnet | low | `claude --agent scribe --effort low` |
| ops | Runs builds, installs, pods, and the harness checks | haiku | low | `claude --agent ops --effort low` |
| pm | Reports the live task board, branches, and worktrees from Orca and git; verifies narrative docs and flags drift | sonnet | medium | `claude --agent pm --effort medium` |
| auditor | Read-only whole-codebase audit (security, performance, bundle, dependencies); reports ranked findings, writes no code | sonnet | medium | `claude --agent auditor --effort medium` |

Agent frontmatter sets only `model` (there is no per-agent effort
field); the coordinator applies the recorded effort with `--effort`
at spawn time, per the table above.

### Ponytail isolation

The reviewer's `/ponytail-review` command vendors only the review
prompt from ponytail 4.9.0 (`harness/kiko/commands/ponytail-review.md`).
No ponytail hooks are registered anywhere (no `SessionStart`,
`SubagentStart`, or `UserPromptSubmit` from ponytail). The ponytail
persona applies only inside that command's own output; the STE style
and every other agent's output stay unaffected.

### Superpowers

The plugin does not copy superpowers. Its skills
(`harness-workflow`, `design-system`, `retrospect`, `ops`) and its
agents point at superpowers skills directly (`superpowers:test-driven-development`,
`superpowers:systematic-debugging`, `superpowers:using-git-worktrees`,
`superpowers:requesting-code-review`, `superpowers:writing-skills`,
`superpowers:dispatching-parallel-agents`, `superpowers:brainstorming`,
`superpowers:writing-plans`, `superpowers:executing-plans`,
`superpowers:subagent-driven-development`,
`superpowers:verification-before-completion`,
`superpowers:finishing-a-development-branch`), reusing the installed
`superpowers` plugin rather than duplicating any of its content.
