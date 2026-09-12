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

Some tools cannot see how a dependency is actually used and would
otherwise report a false positive. Each exception below is a real,
verified usage, not dead weight:

- **`knip.json` `ignoreDependencies`**: `@babel/runtime` (injected by
  `@babel/plugin-transform-runtime` as helper imports in compiled
  output, never a static import), `@typescript/native-preview` (the
  `tsgo` / TS7 binary, reserved for a future typecheck script that
  does not exist yet), `jscpd`, `knip`, and `depcheck` (each invoked
  only via `npx --no-install <tool>` inside its own
  `scripts/checks/*.sh` wrapper, never from a package.json script
  Knip's static scan can see). Also `@env` — the virtual module that
  the `react-native-dotenv` Babel plugin synthesizes at transform time
  (`import { PRICE_ENDPOINT } from '@env'` in `src/rates/coingecko.ts`);
  it is not a real npm package, so Knip's resolver reports the import
  as an unlisted dependency. The package itself (`react-native-dotenv`)
  is seen through `babel.config.js`; only the synthetic `@env`
  specifier needs ignoring. Also `babel-plugin-inline-import` — a
  Babel plugin referenced only as the string `'inline-import'` in
  `babel.config.js` (it inlines the drizzle-orm migration `.sql`
  files as string exports), never imported from source, so Knip's
  static scan cannot see the usage. Also `babel-plugin-module-resolver`
  — a Babel plugin referenced only as the string `'module-resolver'` in
  `babel.config.js` (it resolves the `@kiko/*` path aliases to `src/*`),
  never imported from source, so Knip's static scan cannot see the usage.
- **`tsconfig.json` `compilerOptions.types`**: the base
  `@react-native/typescript-config` pins `types: ["jest"]`, which
  drops the Node ambient globals and module typings that four test
  files legitimately use — `src/db/schema.category-overrides.test.ts`
  and `src/categories/categories.repo.test.ts` read
  `drizzle/migrations` through `node:fs` + `__dirname`,
  `__tests__/info-plist.test.ts` reads `ios/Kiko/Info.plist` the same
  way, and `src/holdings/interest.test.ts` sets `process.env.TZ` to
  force a DST-observing zone. Jest runs on Node, so these are real,
  available globals, not a shim; the list is widened to
  `["jest", "node"]` (never to `[]`, which would admit every
  `@types/*` package in `node_modules` and silently weaken the
  check). This is a genuine widening of what `check:typecheck` can
  see, not a suppression of any error it reports. The two other
  `global` uses were fixed in the code instead — `jest.spyOn(global,
  ...)` became `jest.spyOn(globalThis, ...)`, which needs no Node
  typings at all. Be honest about the cost: `tsconfig.json` is a
  SINGLE project covering source and tests alike, so this widening is
  project-wide — a **production** file that imported `node:fs` would
  now typecheck clean instead of failing, even though React Native has
  no Node runtime and it would crash on device. Nothing does that
  today, and `check:security`/review are the backstop; the eventual
  remedy is a second, test-scoped tsconfig project (tests reference a
  `tsconfig.test.json` that adds `node`, while the app project keeps
  `types: ["jest"]`), which would make the widening unreachable from
  `src/**` non-test code. That is deferred, not forgotten.
- **`.depcheckrc.json` `ignores`**: the same CLI-only-invoked tools
  (`jscpd`, `knip`, `depcheck`) plus `@babel/runtime`,
  `@react-native-community/cli` and `-cli-platform-ios` (invoked by
  the `react-native` CLI, not imported), `@stryker-mutator/core` /
  `-jest-runner` (used via `stryker.conf.json` + npx), `@types/jest`
  (type-only), `@types/node` (type-only, in the same class as
  `@types/jest`: it is never imported, it is reached through
  `tsconfig.json`'s `types: ["jest", "node"]` so the file-reading
  tests can see `node:fs`/`node:path`/`__dirname`/`process`), and
  `typescript` (provides `tsc`/type declarations for the toolchain,
  and now backs `check:typecheck`, but is still never imported from
  source). Also
  `react-native-screens` (a required runtime peer of
  `@react-navigation/native-stack` — the native stack renders through
  it; it is imported inside `native-stack`, never by app code, so
  depcheck's static scan cannot see it), `react-native-nitro-modules`
  (the NitroModules native backend that `react-native-unistyles` is
  built on; required at runtime, never statically imported by app
  code), and `react-native-bottom-tabs` (the native tab-bar peer of
  `@bottom-tabs/react-navigation` — its `NativeBottomTabView` imports
  the real `TabView` component from `react-native-bottom-tabs` to
  render the tab bar on-device; only `@bottom-tabs/react-navigation`
  is imported from app code, in `src/navigation/root.navigator.tsx`,
  so depcheck's static scan cannot see `react-native-bottom-tabs`
  itself being used). Also `react-native-dotenv` — a Babel plugin referenced only
  as the string `'module:react-native-dotenv'` in `babel.config.js`,
  never imported from source, so depcheck's static scan cannot see the
  usage and reports it as an unused devDependency. Also
  `babel-plugin-inline-import` — a Babel plugin referenced only as the
  string `'inline-import'` in `babel.config.js` (it inlines the
  drizzle-orm migration `.sql` files as string exports), never
  imported from source, for the same reason. Also
  `babel-plugin-module-resolver` — referenced only as the string
  `'module-resolver'` in `babel.config.js` (it resolves the `@kiko/*`
  path aliases to `src/*`), never imported from source, for the same
  reason.
- **`.gitleaks.toml` allowlist**: `ios/Podfile.lock` — CocoaPods lists
  a SHA1 checksum per pod, which gitleaks' `generic-api-key` rule
  flags as a false positive (verified fingerprint:
  `ios/Podfile.lock:generic-api-key:1966`). Also `.superpowers/.*` —
  gitignored SDD scratch. Its generated review-diff artifacts echo
  `ios/Podfile.lock` CocoaPods SHA1 checksums (same false-positive
  class as the entry above) that trip `generic-api-key`, and a new
  uniquely-named diff is written on every review cycle, so a
  per-finding exception cannot stay green. Nothing under
  `.superpowers/` ever enters git history (the threat the secrets
  check guards against) — same class as `node_modules`/`ios/Pods`/
  `vendor`, so it is path-allowlisted the same way. Do not quote a
  literal 40-character hex checksum value in any tracked file. Also
  `ios/build/.*` — the generated, gitignored Release device build
  output. Its minified `main.jsbundle` (produced by a Release
  `-iphoneos` build) contains minified identifiers such as
  `obj2Keys.length` and `_usePropsWithDefaults2` that trip
  `generic-api-key`. gitleaks scans the filesystem (`--no-git`) and
  picks these up even though `ios/build/` never enters git — same
  false-positive class as the `ios/Podfile.lock`/`.superpowers/`
  entries above, path-allowlisted the same way as
  `node_modules`/`ios/Pods`/`vendor`. Also a `regexes` entry for the
  bech32 address `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq` — the
  canonical BIP-173 example, used as test data throughout
  `docs/superpowers/plans/2026-09-04-crypto-btc-sync.md` (16
  occurrences); a public documentation example, not a secret, that
  trips `generic-api-key` only on the `metadataKey: '...'` line.
  Allowlisting the exact value is narrower than a path allowlist and
  keeps real-secret scanning of every tracked file intact.
- **`.jscpd.json` `ignore`**: `**/drizzle/migrations/meta/*_snapshot.json`
  — drizzle-kit's schema snapshots are tool-generated and *cumulative*:
  each `NNNN_snapshot.json` embeds the entire prior schema plus that
  migration's delta, so consecutive snapshots are near-identical by
  design (`0000`/`0001`/`0002` clone each other at ~35–65%). There is
  nothing to "extract into a shared function" — drizzle-kit owns the
  format and regenerates these files wholesale, so copy/paste detection
  is a pure false positive on them. Only the generated `*_snapshot.json`
  files are excluded; the hand-authored `.sql` migrations and every
  other JSON file stay in scope.
- **`rules/fixtures/**` (Biome `files.includes`, `knip.json` `ignore`,
  `.jscpd.json` `ignore`, and `--exclude 'fixtures'` in
  `scripts/checks/security.sh`)**: the positive/negative fixture pair that
  proves each project Semgrep rule still fires. A positive fixture is
  deliberately non-conforming, never-imported code (an unredacted widget money
  view, an unprotected App Group write, a Keychain secret pushed into React
  state), and each pair is near-identical by construction — the negative fixture
  is the positive one plus the fix. Verified: without these exclusions a
  `.bad.tsx` fails Biome, reads as an unused file to Knip, and a pair reports
  40% duplicated lines / 43.71% duplicated tokens to jscpd, all by design. The
  semgrep `--exclude` is the bare directory name `fixtures` (semgrep matches it
  per path component), so it hits only `rules/fixtures`; the app's own
  `src/**/__fixtures__` stays in scope. No coverage is lost:
  `npm run check:rules` (`scripts/checks/semgrep-rules.sh`) is the check that
  DOES scan the directory, and it fails if any rule stops matching its positive
  fixture or starts matching its negative one.
- **Stryker mutate-set exclusions (`stryker.conf.json` `mutate`
  negations + the changed-file filter in `scripts/checks/mutation.sh`)**:
  two NON-LOGIC categories are excluded from the set of files Stryker
  mutates, in both run modes (the whole-project fallback array and the
  diff-scoped changed-file filter). (1) **i18n locale catalogs
  (`src/i18n/locales/**`)** — pure nested string-data objects with no
  logic a surviving mutant could meaningfully expose (hundreds of
  low-value string mutants); the
  locale test assertions (e.g. `en.button-casing.test.ts`) still run
  under Jest, so string/casing coverage is unaffected — only the mutation
  report drops those keys. (2) **`**/*.d.ts`** — type-only declarations,
  erased at compile time, so Stryker generates no runtime mutants from
  them; excluding them only trims the mutate-list. Nothing else is
  excluded: `src/design-system/palette.ts`, `theme.ts`, `entity-tint.ts`,
  every `*.styles.ts`, `src/i18n/index.ts`, the mixed const+function
  modules, and the barrels all stay IN scope. `drizzle/migrations/**` is
  already outside the `.ts/.tsx` mutate scope and needs no pattern. See
  the `mutate` array in `stryker.conf.json` and the changed-file `grep
  -Ev` filter in `scripts/checks/mutation.sh` for the exact patterns
  (not restated here so they cannot drift).
- **Stryker sandbox exclusions (`stryker.conf.json` `ignorePatterns`)**:
  Stryker copies every non-ignored project file into a temp sandbox before
  each run (verified in `@stryker-mutator/core` 8.7.1
  `fs/project-reader.js` + `sandbox/sandbox.js`; its own always-ignored set
  is `node_modules`, `.git`, `*.tsbuildinfo`, `/stryker.log`, `.next`,
  `.nuxt`, `.svelte-kit`, plus the temp dir and the incremental/html/json
  report files — `node_modules` is symlinked, not copied). `ignorePatterns`
  keeps large NON-SOURCE, NON-TEST-READ dirs out of that copy: `ios` and
  `android` (native projects; pre-existing), plus `vendor` (the vendored
  CocoaPods Ruby bundle under `vendor/bundle/ruby/...`), `coverage`
  (generated jest coverage), `docs` (Markdown, never imported), and
  `.superpowers` (gitignored SDD scratch). Each was verified to have ZERO
  filesystem reads from any test or source module (grep of every
  `*.test.ts(x)` / `__tests__/**` / jest setup for `readFileSync`,
  `existsSync`, `__dirname`, `require` of a non-module path). **KEEP-LIST**
  — external paths tests DO read, which must stay in the sandbox and are
  therefore NOT ignored: `drizzle/migrations/**` (read by
  `src/db/schema.*.test.ts`, `src/categories/categories.repo.test.ts`,
  and `src/db/__fixtures__/seed-category-colors.ts` via `__dirname`
  +`node:fs`) and `scripts/checks/*.sh` (read by the `__tests__/mutation-*`
  wrapper tests). `reports/` is deliberately kept: Stryker's incremental
  report (`incremental: true`) is read from the PROJECT ROOT and is already
  in the always-ignored set, so keeping the dir is harmless and safer than
  excluding it. `ios` stays ignored even though `__tests__/info-plist.test.ts`
  reads `ios/Kiko/Info.plist`: the Stryker jest-runner defaults
  `enableFindRelatedTests: true`, so only tests transitively importing a
  mutated source file run, and that test imports no app source — it never
  runs under Stryker, so the missing `ios/` in the sandbox never breaks it.
  Final confirmation of any missing-file mistake comes from the FIRST real
  mutation run after integration: Stryker runs the covering test suite once
  before mutating, so a wrongly-excluded read fails FAST with a clear
  ENOENT rather than silently corrupting the score — that fail-fast is the
  accepted safety net.
- **`.npmrc` `min-release-age-exclude`**: `Kiko`, the first-party
  package name, is exempt from the dependency min-age rule below.
  `react-native` is exempt for the same category of reason: it is an
  explicitly pinned core framework, not a freshly-published
  auto-selected dependency, and react-native@0.87.1 being <7 days old
  otherwise breaks npm's ranged-peer resolver (a dependent like
  react-native-unistyles declares `react-native>=0.76.0`, and
  `min-release-age` filtering RN out of the packument means npm
  cannot validate that range against it — surfacing as an ERESOLVE
  error without `--legacy-peer-deps`).

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
| developer | Writes all TypeScript/React Native code | opus | high | `claude --agent developer --effort high` |
| planner | Writes implementation plans from a spec or feature request | opus | high | `claude --agent planner --effort high` |
| debugger | Isolates faults, writes no code | opus | high | `claude --agent debugger --effort high` |
| reviewer | Reviews diffs: correctness, project conventions, then ponytail over-engineering findings | opus | high | `claude --agent reviewer --effort high` |
| qa | Writes Jest/RNTL unit tests and Maestro E2E flows | sonnet | high | `claude --agent qa --effort high` |
| designer | Owns theme tokens and shared styled components | sonnet | high | `claude --agent designer --effort high` |
| explorer | Read-only codebase search | sonnet | medium | `claude --agent explorer --effort medium` |
| retrospect | Gathers durable lessons after a run | sonnet | medium | `claude --agent retrospect --effort medium` |
| scribe | Persists durable knowledge (memory, skills, agents, plugin) | sonnet | low | `claude --agent scribe --effort low` |
| ops | Runs builds, installs, pods, and the harness checks | haiku | low | `claude --agent ops --effort low` |
| pm | Reports the live task board, branches, and worktrees from Orca and git; verifies narrative docs and flags drift | sonnet | medium | `claude --agent pm --effort medium` |
| auditor | Read-only whole-codebase audit (security, performance, bundle, dependencies); reports ranked findings, writes no code | opus | high | `claude --agent auditor --effort high` |

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
