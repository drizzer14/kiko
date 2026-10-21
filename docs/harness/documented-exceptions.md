# Documented exceptions (harness ignore-lists and suppressions)

> Reference detail moved out of CLAUDE.md (2026-09-15) to keep the root harness doc lean. CLAUDE.md points here. This is the authoritative content; edit it here.


Some tools cannot see how a dependency is actually used and would
otherwise report a false positive. Each exception below is a real,
verified usage, not dead weight:

- **`knip.json` `ignoreDependencies`**: `@babel/runtime` (injected by
  `@babel/plugin-transform-runtime` as helper imports in compiled
  output, never a static import), `@typescript/native-preview` (the
  `tsgo` / TS7 binary, reserved for a future typecheck script that
  does not exist yet), `jscpd` and `depcheck` (each invoked
  only via `npx --no-install <tool>` inside its own
  `scripts/checks/*.sh` wrapper, never from a package.json script
  Knip's static scan can see). Also `@env` — the virtual module that
  the `react-native-dotenv` Babel plugin synthesizes at transform time
  (`import { PRICE_ENDPOINT } from '@env'` in `src/rates/coingecko/coingecko.ts`);
  it is not a real npm package, so Knip's resolver reports the import
  as an unlisted dependency. The package itself (`react-native-dotenv`)
  is seen through `babel.config.js`; only the synthetic `@env`
  specifier needs ignoring. The Babel plugins `babel-plugin-inline-import`
  and `babel-plugin-module-resolver` are not ignored: Knip sees both
  through `babel.config.js`.
- **`tsconfig.json` `compilerOptions.types`**: the base
  `@react-native/typescript-config` pins `types: ["jest"]`, which
  drops the Node ambient globals and module typings that three test
  files legitimately use — `src/db/schema.category-overrides.test.ts`
  and `src/categories/repo/categories.repo.test.ts` read
  `drizzle/migrations` through `node:fs` + `__dirname`, and
  `__tests__/info-plist.test.ts` reads `ios/Kiko/Info.plist` the same
  way. Jest runs on Node, so these are real,
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
  is imported from app code, in `src/navigation/root-navigator/root.navigator.tsx`,
  so depcheck's static scan cannot see `react-native-bottom-tabs`
  itself being used). Also `react-native-dotenv` — a Babel plugin referenced only
  as the string `'module:react-native-dotenv'` in `babel.config.js`,
  never imported from source, so depcheck's static scan cannot see the
  usage and reports it as an unused devDependency. The Babel plugins
  `babel-plugin-inline-import` and `babel-plugin-module-resolver` are
  not ignored: depcheck sees both through `babel.config.js`.
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
  keeps real-secret scanning of every tracked file intact. Also the
  path `(^|/)memory/refs/.*` — the main checkout's untracked
  `memory/refs/` folder of local orchestrator notes (briefs, the
  duration log, pasted review diffs). `gitleaks detect --no-git` scans
  the filesystem, so it reads that folder, and a pasted review diff
  trips `generic-api-key` on a Swift identifier ending in `Key` (the
  one finding there today, verified against the main checkout:
  `memory/refs/reminders-superpowers/sdd/2026-09-28-reminders/review-2bc3f9e5..bd51af35.diff`).
  It cannot hide a committed secret: `/memory/` is in `.gitignore`, so
  a `git add -A` never stages it and nothing under it can reach git
  history, the threat this check guards against; `git ls-files memory`
  also prints nothing. The path is narrowed to a `memory/refs/` folder,
  not every folder named `memory`. Re-verify with
  `git check-ignore memory/refs/x` (exit 0) and `git ls-files memory`
  (empty) before relying on it.
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
- **`.jscpd.json` `ignore`**: `**/net-worth-line/net-worth-line.component.tsx`
  and `**/category-trend-line/category-trend-line.component.tsx` — the two
  line-chart components intentionally mirror each other's structure
  (documented in the `kiko-charts` skill: parallel scale/tick/path-building
  helpers for a two-axis SVG line chart). Verified PRE-EXISTING at base
  `5838bf7` (before the chart date-label change): the two files already
  shared 182 lines (13.03%) scoped together, not introduced by that change.
  Project-level `npm run check:dup` and `make gate` both PASS (the
  duplication only trips the changed-file-scoped medium-tier run when both
  files are in scope together). The `kiko:reviewer` ponytail review verdict
  on this pair was "lean already, nothing to cut" — there is no shared
  block left to extract without coupling two independently-evolving chart
  components through an artificial abstraction. Only these two component
  files are ignored; their test files and every other chart file stay in
  scope. Revisit or remove this exception if the two charts' structure
  ever diverges enough that the duplication is no longer a deliberate
  mirror.
- **Tracked debt, not an ignore: `check:dup` size-limit warning**
  (`scripts/checks/dup.sh`, dated 2026-10-11). jscpd 4.3.0 skips a file over
  1000 lines or 100kb without a word, so the blocking run never measured the
  large files. `dup.sh` now runs a second, NON-blocking pass: it measures each
  skipped file ALONE with the limits raised and prints a `WARNING` on stderr
  (exit code unchanged) for every file over the 5% threshold. No file is
  allowlisted and the threshold is not raised: the files listed below are measured
  debt that each warning names (the `dup.sh` warning output is the live list). Measured 2026-10-11 at base `7fc680a5`:
  `home.screen.test.tsx` 38.24%, `accounts.screen.test.tsx` 23.87%,
  `statement-import.screen.test.tsx` 14.72%, `transactions.repo.test.ts`
  10.14%, `sync.test.ts` 7.67%, `statistics.screen.test.tsx` 7.77%
  (this one figure re-measured 2026-10-19 at `d78cfccd`; the rise from 7.38% is
  not a regression of the Binance branch: it came mostly from `62f248ed`,
  `e7cc80f5` and main merges, so the entry moved, not the test),
  `net-worth-series.test.ts` 7.25%, `restore-snapshot.test.ts` 7.21%,
  `import-statement.test.ts` 7.09%, `account-form.screen.test.tsx` 6.55%,
  `transactions.repo.remove-cascade.test.ts` 5.91%, `holdings.repo.test.ts`
  5.75%, `holding-form.screen.test.tsx` 5.36% (every non-test source file over
  the limit is under 2%). A second figure is tracked beside the per-file ones:
  one more run measures the whole scope TOGETHER with the limits raised,
  because a clone between a large file and another file is invisible to the
  alone runs. Its baseline on 2026-10-11 is 7.33% of lines, against 3.24% for
  the blocking run with the default limits, and it applies to the no-argument
  (whole-repo) run only: a scoped run's combined figure is not comparable; a warning for a combined total
  above the threshold is expected until the sweep lands, and a figure above
  7.33% is a new regression. A listed file's figure is a ceiling: a later rise
  above it is a new regression; fix the test, or re-record the figure only with
  a reviewer finding that names the cause. **Flip condition:** a separate sweep track makes
  every large file 5% or less alone AND the combined raised total 5% or less;
  then this warning becomes a failure (`exit 2` through `print_block`) and
  this entry is deleted. The
  warning is a stated exception to the "silent on success" wrapper contract
  (kiko-linter's "The wrapper contract").
- **`knip.json` `entry`** (an entry point, not an ignore):
  `scripts/bundle-contains.js` — the bundle freshness checker that only
  `scripts/deploy-device.sh` runs (`node scripts/bundle-contains.js`), so
  Knip sees no importer and reports it as an unused file. It is a real
  executable entry point; as an `entry` Knip still analyzes it.
- **`knip.json` `ignore`**: `scripts/checks/kill-guard.js` — the PreToolUse
  hook script that `scripts/checks/kill-guard.sh` invokes (`node
  kill-guard.js`) to tokenize a Bash-tool command and deny pkill/killall,
  pattern/process-group kills, any `git stash`, an unquoted heredoc
  delimiter, a git history change on the main checkout, a shell write
  into `src/`, `__tests__/`, `rules/`, `e2e/`, `drizzle/`, `scripts/`, `githooks/`,
  `.claude/skills/`, `.claude/agents/`, `harness/kiko/`, or a YAML
  file, and a while/until process-scan
  wait loop (see `docs/harness/checks.md` "Automatic wiring" and
  `.claude/skills/kiko-linter/SKILL.md`). It is reached only from a sibling
  `.sh` wrapper's `node` invocation — never a static `import`/`require` from
  any TypeScript/JavaScript source, and never a package.json script Knip's
  static scan can see (unlike `scripts/ensure-env.js`, which IS a
  `postinstall` package.json script and so needs no ignore entry) — so
  Knip's reachability graph reports it as an unused file. It is exercised
  directly by `__tests__/kill-guard.test.ts` and
  `__tests__/kill-guard-writes.test.ts`, and
  `__tests__/kill-guard-wait-loops.test.ts`, which spawn `kill-guard.sh` (and
  so `kill-guard.js`) or `node` on it as a subprocess, not an import,
  so Jest's coverage does not make Knip see it as reachable either.
- **`knip.json` `ignore`**: `scripts/checks/pre-write-guard.js` — the
  PreToolUse hook script that `scripts/checks/pre-write-guard.sh` invokes
  (`node --experimental-strip-types --no-warnings pre-write-guard.js`) to
  rebuild an Edit/Write/MultiEdit's proposed file content and deny the
  write when it introduces a known violation (see `docs/harness/checks.md` "Automatic
  wiring" and `.claude/skills/kiko-linter/SKILL.md`), the same reason as
  `kill-guard.js` above. It is reached only from a sibling `.sh` wrapper's
  `node` invocation — never a static `import`/`require` from any
  TypeScript/JavaScript source, and never a package.json script Knip's
  static scan can see — so Knip's reachability graph reports it as an
  unused file. It is exercised directly by
  `__tests__/pre-write-guard.test.ts`, which spawns `pre-write-guard.sh`
  (and so `pre-write-guard.js`) as a subprocess, not an import, so Jest's
  coverage does not make Knip see it as reachable either.
- **`knip.json` `ignore`**: `scripts/checks/import-order.js` — the same
  shape as `kill-guard.js` above. `scripts/checks/import-order.sh`
  reaches it only via a `node` invocation (both the fast-tier per-file
  check and the project-wide `check:import-order` mode), never a static
  `import`/`require`, and never a package.json script Knip's static scan
  can see, so Knip's reachability graph reports it as unused. Exercised
  directly by `__tests__/import-order.test.ts`, which spawns
  `import-order.sh` (and so `import-order.js`) as a subprocess, and by a
  direct `node import-order.js --write` invocation in the same test file
  — neither of which Jest's static import graph makes Knip see as
  reachable.
- **`knip.json` `ignore`**: `scripts/checks/full-word-identifiers.js` —
  the same shape as `import-order.js`/`kill-guard.js` above.
  `scripts/checks/full-word-identifiers.sh` reaches it only via a `node`
  invocation (both the fast-tier per-file check and the project-wide
  `check:full-word-identifiers` mode), never a static `import`/`require`,
  and never a package.json script Knip's static scan can see, so Knip's
  reachability graph reports it as unused. Exercised directly by
  `__tests__/full-word-identifiers.test.ts`, which spawns
  `full-word-identifiers.sh` (and so `full-word-identifiers.js`) as a
  subprocess — not an import, so Jest's coverage does not make Knip see it
  as reachable either.
- **`knip.json` `ignore`**: `scripts/checks/blank-line-separation.js` — the
  same shape as `import-order.js`/`full-word-identifiers.js`/
  `kill-guard.js` above. `scripts/checks/blank-line-separation.sh` reaches
  it only via a `node` invocation (both its per-file mode and its
  project-wide mode), and `scripts/checks/pre-write-guard.js` reaches it
  only via `runSpawnedNodeChecker`'s own `spawnSync` — never a static
  `import`/`require`, and never a package.json script Knip's static scan
  can see (it mechanizes kiko-code-style's "Blank lines before statement
  blocks" and "Blank line between adjacent JSX sibling nodes" rules, wired
  into the pre-write guard's `NODE_RULES` as `kiko-blank-line-separation`;
  its project-wide mode is `npm run check:blank-line-separation`,
  part of `check:all`; Knip cannot see the `node` call from the `.sh`
  wrapper), so Knip's reachability graph reports it as unused. Exercised directly by
  `__tests__/blank-line-separation.test.ts`, which spawns
  `blank-line-separation.sh` (and so `blank-line-separation.js`) as a
  subprocess, and by a direct `node blank-line-separation.js [--write]`
  invocation in the same test file, and by
  `__tests__/pre-write-guard.test.ts`'s `kiko-blank-line-separation` case
  (via `pre-write-guard.sh`) — none of which Jest's static import graph
  makes Knip see as reachable.
- **`knip.json` `ignore`**: `scripts/checks/screen-imports.js` — the same
  shape as `blank-line-separation.js`/`import-order.js`/`kill-guard.js`
  above. `scripts/checks/screen-imports.sh` reaches it only via a `node`
  invocation (both its per-file mode and its project-wide mode), and
  `scripts/checks/pre-write-guard.js` reaches it only via
  `runSpawnedNodeChecker`'s own `spawnSync` — never a static `import`/
  `require`, and never a package.json script Knip's static scan can see
  (it mechanizes the pre-write-guard design spec's rule 12, "no import from
  another screen's folder", wired into the pre-write guard's `NODE_RULES`
  as `kiko-no-cross-screen-import`; its project-wide mode is
  `npm run check:screen-imports`, part of `check:all`; Knip cannot see the
  `node` call from the `.sh` wrapper), so Knip's reachability graph reports it as unused. Exercised
  directly by `__tests__/screen-imports.test.ts`, which spawns
  `screen-imports.sh` (and so `screen-imports.js`) as a subprocess, and by
  a direct `node screen-imports.js` invocation in the same test file, and
  by `__tests__/pre-write-guard.test.ts`'s `kiko-no-cross-screen-import`
  case (via `pre-write-guard.sh`) — none of which Jest's static import
  graph makes Knip see as reachable.
- **`knip.json` `ignore`**: `scripts/checks/feature-imports.js` — the same
  shape as `screen-imports.js` above. `scripts/checks/feature-imports.sh`
  reaches it only via a `node` invocation (per-file, project-wide and
  `--tree`), and `scripts/checks/pre-write-guard.js` only via
  `runSpawnedNodeChecker`'s `spawnSync` (the `kiko-feature-imports`
  `NODE_RULES` row). No package.json script names it since the
  sweep-only `report:feature-imports` script (and its `--report`/`--json`
  modes) was removed once the sweep reached 0 findings. Exercised by
  `__tests__/feature-imports.test.ts` (direct `node feature-imports.js`
  runs plus `feature-imports.sh` as a subprocess) and by
  `__tests__/pre-write-guard.test.ts`'s `kiko-feature-imports` case —
  none of which Jest's static import graph makes Knip see as reachable.
- **`knip.json` `ignore`**: `scripts/checks/guard-replay.js` — the same
  shape as `pre-write-guard.js` above. `scripts/checks/guard-replay.sh`
  (the medium tier's pre-write guard replay, also `check:guard-replay`)
  reaches it only via a `node` invocation, never a static
  `import`/`require`. Exercised by `__tests__/guard-replay.test.ts`,
  which spawns `guard-replay.sh` and `medium.sh` as subprocesses, so
  Jest's import graph does not make Knip see it as reachable either.
  The same test also loads its one export, `stopTierDeadlineSeconds`,
  with a `require` of a computed path (`REPLAY_ENGINE`), which Knip
  does not resolve, so the entry is still needed.
- **`knip.json` `ignore`**: `scripts/checks/shipped-migrations.js` — the
  same shape as `guard-replay.js` above. `scripts/checks/shipped-migrations.sh`
  (`check:shipped-migrations`, also run by the medium tier) reaches it only
  via a `node` invocation, never a static `import`/`require`, so Knip reports
  it as unused. Exercised by `__tests__/shipped-migrations.test.ts`, which
  runs a copy of the wrapper and the checker as subprocesses in a throwaway
  git repository, not an import.
- **`knip.json` `ignore`**: `scripts/checks/closure-table.js` — the same
  shape as `shipped-migrations.js` above. `scripts/checks/closure-table.sh`
  (`check:closure`, run by hand on a closure table, not part of `check:all`)
  reaches it only via a `node` invocation, never a static `import`/`require`,
  so Knip reports it as unused. Exercised by `__tests__/closure-table.test.ts`,
  which runs the script as a subprocess in a throwaway git repository, not an
  import.
- **`knip.json` `ignore`**: `scripts/checks/comment-only-changes.js` — the
  same shape as `shipped-migrations.js` above. `scripts/checks/mutation.sh`
  reaches it only via a `node` invocation, never a static `import`/`require`,
  so Knip reports it as unused. Exercised by
  `__tests__/comment-only-changes.test.ts` (the script, in a throwaway git
  repository) and `__tests__/mutation-comment-only.test.ts` (the wrapper),
  both as subprocesses, not an import.
- **`knip.json` `ignore`**: `scripts/checks/mutation-ranges.js` — the same shape as
  `comment-only-changes.js` above. `scripts/checks/mutation.sh` reaches it only via a `node`
  invocation, never a static `import`/`require`, so Knip reports it as unused. Exercised by
  `__tests__/mutation-ranges.test.ts` (the script, with a synthetic diff on stdin) and the
  `__tests__/mutation-stream.test.ts` / `mutation-cap.test.ts` wrappers, both as subprocesses.
- **`scripts/checks/comment-only-changes.js` requires `typescript`** — the
  one checker in `scripts/checks/` that is not dependency-free (see
  kiko-linter's "Node checkers"). The rule exists because the guard-replay
  scratch checkout has no `node_modules`, so a checker that requires an npm
  package fails closed on every replayed file. This script never runs there:
  `mutation.sh` is manual, not hook-wired, and starts it only in a full
  worktree, where Stryker itself already needs `node_modules`; the pre-write
  guard and `guard-replay.js` never call it. A failed require is not an error
  either: it keeps every file, so the mutation run mutates what it would
  have without the filter. `typescript` is a pinned devDependency.
- **`knip.json` `ignore`**: `scripts/checks/comment-line-width.js` — the
  same shape as `blank-line-separation.js` above.
  `scripts/checks/comment-line-width.sh` reaches it only via a `node`
  invocation (its project-wide mode, `npm run check:comment-line-width`;
  it has no per-file mode), and `scripts/checks/pre-write-guard.js`
  reaches it only via `runSpawnedNodeChecker`'s own `spawnSync` (the
  `kiko-comment-line-width` `NODE_RULES` row) — never a static
  `import`/`require`. The project-wide mode is part of `check:all`. The
  checker has no allowlist and no inline override (its
  `NODE_RULES` row sets `overridable: false`, so the guard ignores an
  override comment for it); its only exemption is structural (a comment with no wrap point, one long
  URL), defined in its header and in kiko-code-style's "Wrap comments at 100
  columns". Exercised by `__tests__/comment-line-width.test.ts`, which
  spawns the checker and the wrapper as subprocesses, and by
  `__tests__/pre-write-guard.test.ts`'s `comment-line-width` case.
- **`knip.json` `ignore`**: `scripts/checks/component-i18n-namespace.js` — the
  same shape as `comment-line-width.js` above.
  `scripts/checks/component-i18n-namespace.sh` reaches it only via a `node`
  invocation (its project-wide mode, `npm run check:component-i18n-namespace`;
  it has no per-file mode), and `scripts/checks/pre-write-guard.js` reaches it
  only via `runSpawnedNodeChecker`'s own `spawnSync` (the
  `kiko-component-i18n-namespace` `NODE_RULES` row) — never a static
  `import`/`require`. The project-wide mode is part of `check:all`. The
  checker has no allowlist. Exercised by
  `__tests__/component-i18n-namespace.test.ts`, which spawns the checker and
  the wrapper as subprocesses, and by `__tests__/pre-write-guard.test.ts`'s
  `component-i18n-namespace` case.
- **`knip.json` `ignore`**: `scripts/checks/specifier-scanner.js` — the
  shared specifier scanner. Its only importers are the checkers
  `feature-imports.js`, `screen-imports.js`, `plural-count.js`,
  `comment-line-width.js`, and `component-i18n-namespace.js` (a static
  `require`), and all five are themselves
  in `ignore` above, so Knip never walks into it and reports it as an
  unused file. It is reached exactly as far as those checkers are, and
  exercised through their tests.
- **`knip.json` `ignore`**: `scripts/checks/mutation-rerun.js` — run by path as
  `node "$DIR/mutation-rerun.js"` in `scripts/checks/mutation.sh` (the TIMEOUT-HEAVY rerun),
  never a static import, so Knip sees no importer.
- **`knip.json` `ignore`**: `scripts/checks/mutation-score.js` — run by path as
  `node "$DIR/mutation-score.js"` in `scripts/checks/mutation.sh` (the change-set scorer and
  `--rerun-candidates`), never a static import, so Knip sees no importer.
- **`knip.json` `ignore`**: `scripts/checks/plural-count.js` — spawned by path as a node child
  process by `scripts/checks/pre-write-guard.js` (`runSpawnedNodeChecker('plural-count.js', ...)`)
  and by `__tests__/plural-count.test.ts`, never a static import, so Knip sees no importer.
- **`knip.json` `ignore`**: `scripts/checks/deps-ranges.js` — the same
  shape as `guard-replay.js`/`import-order.js` above.
  `scripts/checks/deps.sh` (part of `check:deps`) reaches it only via a
  `node` invocation, never a static `import`/`require`, and never a
  package.json script Knip's static scan can see, so Knip's
  reachability graph reports it as unused. Exercised directly by
  `__tests__/deps-ranges.test.ts`, which spawns the script as a child
  process against a fixture `package.json`, not an import, so Jest's
  coverage does not make Knip see it as reachable either.
- **`scripts/checks/feature-imports.js`'s `TEST_ONLY` allowlist**
  (`kiko-feature-imports`): the paths below may be imported deep, through
  `@kiko/<path>`, and only by a test file. No barrel may export them
  (`--tree` `barrel-leak`), and a production file may not import them
  (`test-only-from-production`), so no test code reaches the App Store
  build (kiko-compliance 2.5.19). Each entry and its reason:
  - `test-support/**`: shared test helpers with no owning feature. The
    folder has no barrel.
  - `**/__fixtures__/**`: fixture data (db, monobank, the statement-import
    formats, `bonds/nbu-register`).
  - `db/in-array-clause-test-helper`, `db/render-condition-test-helper`:
    query-shape helpers for the repo tests of other features.
  - `db/capture-set-tx`: its only importers are tests.
  - `rates/monobank-feed-test-helper`: a test-only feed builder.
  - `statement-import/formats/format-test-fixtures`: shared format test
    rows.
  - `crypto-sync/binance/binance.earn-test-fixtures`: the shared Earn walk
    test world; only tests import it.
  - `i18n/locales/flatten-catalog`, `i18n/locales/title-keys`: catalog
    helpers that only the i18n tests use.
- **`scripts/checks/feature-imports.js`'s `AMBIENT_LOOSE` set**: `env.d.ts`,
  `i18n/i18next.d.ts` and `statement-import/windows-1251.d.ts` stay loose
  at a container root (no `--tree` `loose-file` finding). They are ambient
  declarations that nothing imports, so a unit folder and barrel would
  have no importer.
- **`scripts/checks/full-word-identifiers.js`'s own `EXEMPTIONS` list**: an
  exact `(file path suffix, denylisted word, EXACT identifier name)`
  allowlist mechanizing kiko-code-style's "Full words in identifiers"
  exception for "a name forced by a third-party API/DB column/persisted
  JSON key". The `name` field (not just word) matters: it is what lets
  `src/crypto-sync/binance/binance.transactions.ts` exempt only its
  wire-mirrored `txId` field while still catching a DIFFERENT `tx`-bearing
  identifier chosen freely in the SAME file (`BinanceTxSyncDeps`, this
  codebase's own type name, since renamed to `BinanceTransactionSyncDeps`
  during the R1.d sweep — a word-only, file-wide exemption would have
  silently skipped that one too). Each of the 22 entries is a real,
  verified external-format mirror, not a style preference:
  `src/db/run-migrations.ts` + its test + the six
  `src/db/schema.*.test.ts` fixtures (`idx`) mirror drizzle-kit's own
  generated `_journal.json` `{idx, when, tag}` shape, which this runner
  reimplements byte-for-byte (see the file's own header comment);
  `src/bonds/nbu-register/nbu-register.ts` + its test (`val`, from
  `val_code` and from `payments[].pay_val`) mirror the National Bank of
  Ukraine securities register's own external JSON fields; `src/crypto-sync/binance/binance.client.ts` +
  its test (`msg`) mirror Binance's own error-body shape `{code, msg}`;
  `binance.history-client.ts`/`.test.ts` plus `binance.transactions.ts`/`.test.ts`/`.placement.test.ts`
  and `binance.pay-history.real-sqlite.test.ts` (`tx`, from `txId`) mirror the literal field name on Binance's deposit/withdraw
  history records (`GET /sapi/v1/capital/deposit/hisrec` and
  `/withdraw/history`) — found only by reading the ACTUAL diff after an
  initial mechanical `tx` → `transaction` sweep pass, not by inspection
  beforehand, which is exactly why this allowlist is exact-name-scoped
  rather than trusted-by-eye; `src/crypto-sync/btc-wallet/btc-wallet.client.test.ts`
  (`tx`, from `tx_count`) mirrors the Esplora/Blockstream address-stats
  API's own field name; `src/design-system/components/currency-field/currency-field.component.tsx`
  (`num`, from `initialNumToRender`) is React Native's own `FlatList` prop
  name. A denylisted word anywhere else in the tree — including the same
  word in a different file, or a DIFFERENT identifier in the same file —
  still fails; add a new entry here only for another verified
  external-name case, per this file's own standing rule.
- **`rules/fixtures/**` (Biome: `files.includes` drops only the bad
  fixtures, `!rules/fixtures/**/*.bad.*`, and an `overrides` entry turns
  the linter and assist off for the whole folder, so a good fixture is
  format-checked but never linted; `knip.json` `ignore`,
  `.jscpd.json` `ignore`, and
  `--exclude 'fixtures'` in `scripts/checks/security.sh`, plus its drop of
  any `rules/fixtures/` file among its arguments)**: the
  positive/negative fixture pair that
  proves each project Semgrep rule still fires. A positive fixture is
  deliberately non-conforming, never-imported code (a hidden Guideline 2.5.19
  feature flag import, a Keychain secret pushed into React state), and each
  pair is near-identical by construction — the negative fixture
  is the positive one plus the fix. Verified: without these exclusions a
  `.bad.tsx` fails Biome, reads as an unused file to Knip, and a pair reports
  40% duplicated lines / 43.71% duplicated tokens to jscpd, all by design.
  The
  semgrep `--exclude` is the bare directory name `fixtures` (semgrep matches it
  per path component), so it hits every folder named `fixtures` (also
  `e2e/screenshot/fixtures/**`, which project-wide `check:security` never scans); the
  app's own `src/**/__fixtures__` stays in scope. For `rules/fixtures` no coverage is lost:
  `npm run check:rules` (`scripts/checks/semgrep-rules.sh`) is the check that
  DOES scan the directory, and it fails if any rule stops matching its positive
  fixture or starts matching its negative one.
- **Excluded Semgrep registry rules (`--exclude-rule <full check_id>` x33 in
  `scripts/checks/security.sh`, the `EXCLUDED_RULE_IDS` array; pinned by
  `__tests__/security-excluded-registry-rules.test.ts`)**: 33 registry rule
  ids that cannot match this repo, in four groups: the 30 `javascript.express.*`
  rules other than cors, the express
  `javascript.express.security.cors-misconfiguration.cors-misconfiguration`,
  `javascript.sequelize.security.audit.sequelize-injection-express.express-sequelize-injection`,
  and `typescript.react.security.audit.react-unsanitized-method.react-unsanitized-method`
  (31 of the 33 ids start with `javascript.express.`).
  Cause: the registry web rules time out under load, and a timeout fails
  `check:security` closed (binance debugger, 2026-10-18: single files take
  0.6-2.4 s at load about 10 but 7-28 s at load 28-40; `express-ssrf` timed out on
  `src/screens/forms/holding-form/holding-form.screen.test.tsx`). Proof each
  cannot match: none of the rules checks for an `express` import. Their taint
  sources are handler-shaped: a `function ... ($REQ, $RES)` or `function ... ($REQ, $RES, $NEXT)`
  (or a typed `({ $REQ }: Request, $RES: Response[, $NEXT: NextFunction]) =>`) reading
  `$REQ.query`, `.body`, `.params`, `.cookies` or `.headers` (four rules also `$REQ.files`);
  `express-res-sendfile` also takes any function with a `string`-typed parameter.
  Their sinks are an express response method
  (`$RES.send`, `.write`, `.redirect`, `.sendFile`, `.render`, `.set`, `.header`,
  `.setHeader`, `.writeHead`), a call into a package that is imported by no tracked
  file (`puppeteer`, `phantom`, `libxmljs`, `vm2`, `request`, `xml2json`,
  `node-expat`, `serve-index`, `express-session`, `cookie-session`, `express-jwt`,
  `node-serialize`, `serialize-to-js`, `sandbox`, and the template
  engines `pug`, `jade`, `dot`, `ejs`, `nunjucks`, `lodash`, `mustache`, `eta`,
  `squirrelly`, `hogan.js`, `handlebars`; `pug` and `lodash` sit in
  `package-lock.json` as transitive dependencies only), the bare `path` or `vm` module
  (tracked code imports only `node:path`, a different literal), or one of three
  generic shapes (an HTML-looking string built from a value, a dynamic
  `require(x)`, a `sequelize.query(...)` call, the identifier `sequelize` being in
  no tracked file but this harness's own pin and docs). A source can match by accident
  (a test double reading `init.headers`), and an accidental source can reach a generic
  sink with no HTTP handler (a fetch double
  ``function mockFetch(request, init) { return `<html>${request.body}</html>`; }``
  is a `raw-html-format` source and sink). So the proof has two parts. (1) No sink is
  reachable from a handler-shaped function, meaning any 2- or 3-parameter function
  `(request, response[, next])` reading a parameter's `query`, `body`, `params`,
  `cookies`, `headers` or (four rules) `files`, and, for `express-res-sendfile`, any
  function with a `string`-typed parameter: no sink-package call,
  no express response method (no `.sendFile(` or `.sendfile(` call at all), no
  HTML-looking string built from such a value, no
  dynamic `require(x)` (and there is no `createServer`, `.listen(`, `http`, `https`,
  `express`, `koa` or `fastify` import, no `(req, res)` or `(request, response)`
  function, no `Request`/`Response` typed handler). (2) The measured run: a scan
  with only these 33 rules over the repo found 0
  findings and 0 errors in 2092 files (semgrep 1.175.0, 2026-10-18; an earlier
  all-rules run over 2066 files had 0 findings and 2 files that timed out,
  `__tests__/pre-write-guard.test.ts` and `scripts/checks/kill-guard.js`, and a
  grep confirms neither contains `document.write`, `document.writeln` or
  `insertAdjacentHTML`). The `react-unsanitized-method` sinks are only those three
  DOM calls, matched by the TEXT of a `document.write`, `document.writeln` or
  `insertAdjacentHTML` call in any file (a jest test included), which do not exist
  in React Native; no tracked code or test file contains that text. The id
  must be the full check_id: semgrep 1.175.0 treats it as exact, so the short form
  (`javascript.express.security.audit.express-ssrf`) excludes nothing and an
  unknown id is silently ignored; the test pins the full form. The exclusion
  list's content is part of the dedup fingerprint, so a changed list never
  lets an older pass skip a scan. Still running: `react-unsanitized-property`,
  every other `p/typescript`, `p/react` and `p/secrets` rule, and every `kiko-*`
  rule on every file. Never add a file, a `kiko-*` rule, or an id that can match
  here. Re-check trigger: if any (request, response[, next]) HTTP handler is ever
  added (express or not, for example a Node mock server in `scripts/` or `e2e/`), if
  any of the sink packages above is imported, if a dynamic `require(x)` is added, if
  an HTML string is built from a parameter's `body`, `headers`, `query`, `params`,
  `cookies` or `files` inside a 2- or 3-parameter function, if a `.sendFile(` or
  `.sendfile(` call is added, if the text of a `document.write`, `document.writeln`
  or `insertAdjacentHTML` call is added to any file (a jest test too), or if a DOM
  target (a web view that renders DOM, or a web build) is added, remove the
  matching ids in the same change.
- **Stryker mutate-set exclusions (`stryker.conf.json` `mutate`
  negations + the changed-file filter in `scripts/checks/mutation.sh`)**:
  five categories are excluded from the set of files Stryker
  mutates, in both places (the config's own `mutate` array and the
  diff-scoped changed-line filter; the wrapper refuses a whole-project
  run, so the filter is the one a gated run uses). (0) **`scripts/checks/**`** — the
  harness's own check tooling, not app logic; `import-order.js`,
  `kill-guard.js`, and `full-word-identifiers.js` are already exempt by
  extension (plain `.js`, outside the `**/*.ts`/`**/*.tsx` mutate glob),
  but `one-component-per-file.ts` (the one-exported-component-per-`.tsx`
  Jest invariant, moved here from src/code-style/ so it is treated the
  same as the harness's other TypeScript-checked rules) needed an
  explicit pattern since it IS `.ts`. (1) **i18n locale catalogs
  (`src/i18n/locales/**`)** — pure nested string-data objects with no
  logic a surviving mutant could meaningfully expose (hundreds of
  low-value string mutants); the
  locale test assertions (e.g. `en.casing-by-role.test.ts`,
  `uk.casing.test.ts`) still run
  under Jest, so string/casing coverage is unaffected — only the mutation
  report drops those keys. (2) **`**/*.d.ts`** — type-only declarations,
  erased at compile time, so Stryker generates no runtime mutants from
  them; excluding them only trims the mutate-list. (3) **barrels
  (`**/index.ts`)** — pure re-export modules (`export ... from './x'`)
  whose only mutable token is the module-path string; no branch, no
  arithmetic, no logic, and no test imports the excluded barrels
  directly. Every `index.ts` is a barrel: the `i18next.init(...)`
  side-effect module lives in `src/i18n/init/init.ts`, so it stays in
  scope without a re-include. (4) **pure-static styles (`**/*.styles.ts`)** — pure
  `StyleSheet.create` objects (string/number/object-literal tokens only,
  no conditionals or arithmetic); no test imports any `.styles` file, so
  their mutants are pure denominator noise. The two logic-bearing styles
  are RE-INCLUDED (positive patterns after the negation):
  `**/bottom-sheet.styles.ts` (runtime style functions with real `+`
  arithmetic, covered by `bottom-sheet.component.test.tsx`) and
  `**/entity-icon-tile.styles.ts` (exports the `iconTileSize` helper
  function). The mechanism is PURELY glob-based, not logic-based: the
  drop is by PATTERN — EVERY `**/index.ts` and EVERY `**/*.styles.ts`
  is negated — and ONLY the two named files above
  (`bottom-sheet.styles.ts`, `entity-icon-tile.styles.ts`) are
  re-included, BY NAME. So the files that stay in scope
  (`src/i18n/init/init.ts`, `src/design-system/palette/palette.ts`,
  `theme/theme.ts`, `entity-tint/entity-tint.ts`, the mixed
  const+function modules,
  `drizzle/migrations/**`, and every other non-`.styles`, non-barrel
  source) stay in scope simply because they never match the `index.ts`
  or `*.styles.ts` globs — NOT because any logic test spared them.
  MAINTENANCE: a NEW logic-bearing barrel or `*.styles.ts` will be
  SILENTLY dropped (its mutants lost) unless it is added to the
  re-include list in BOTH `stryker.conf.json` `mutate[]` AND the `grep`
  in `scripts/checks/mutation.sh` — the two must stay in sync.
  `drizzle/migrations/**` is
  already outside the `.ts/.tsx` mutate scope and needs no pattern.
  Order matters: each re-include is a positive pattern placed AFTER its
  negation (config patterns apply in array order; a later positive
  re-enables a file a prior `!`-negation disabled — `project-reader.js`).
  NOTE: the CLI `--mutate` REPLACES the config `mutate[]` wholesale
  (`deepMerge` replaces arrays, `deep-merge.js:13`), so on the
  diff-scoped run the config negations do NOT apply — which is why these
  same excludes/re-includes are mirrored in `mutation.sh`'s own `grep`
  filter, not only in `stryker.conf.json`. See the `mutate` array in
  `stryker.conf.json` and the changed-file `grep` filter in
  `scripts/checks/mutation.sh` for the exact patterns and re-includes
  (not restated in full here so they cannot drift).
- **`scripts/checks/mutation-score.js` declaration-only exclusion
  allowlist**: the CHANGE-SET mutation gate (`docs/harness/checks.md`
  `check:mutation` row) excludes a file from BOTH the change-set score
  and its own per-file floor when it is a declaration file. Today:
  **`src/db/schema.ts`** (Drizzle table/column declarations): its
  string-literal mutants (column names) are the schema itself, not
  logic. A real report shows 98 StringLiteral mutants killed in it, so
  the reason is not "no runtime branch". The Drizzle migration
  snapshots and journal under `drizzle/migrations/meta/` are `.json`
  files, and `mutation.sh` passes only `.ts`/`.tsx` files to the gate,
  so they never reach it and need no entry. This is the ONE allowlist
  in that script (`EXCLUDED_FILES`); a new entry needs the same
  concrete, verifiable reason as any other suppression here
  (CLAUDE.md's "Override protocol"), update this entry when one is
  added. A changed file that is ABSENT from the json report is a file
  with no mutants (Stryker writes only files that have some) and is
  n/a, but only after the scorer has checked that the report's own
  recorded scope (`config.mutate`) equals the set of changed-line `--mutate` entries; a
  report that does not match fails the gate.
- **`Stryker disable` comments**: not an allowlist. `check:overrides`
  (`override-guard.sh`) fails a `Stryker disable` comment without
  `OVERRIDE(...)`, because a disabled mutant becomes Ignored and the
  mutation gate leaves Ignored mutants out of the score and the floor.
  No such comment exists in the repo today.
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
  `src/db/schema.*.test.ts`, `src/categories/repo/categories.repo.test.ts`,
  and `src/db/__fixtures__/seed-category-colors.ts` via `__dirname`
  +`node:fs`) and `scripts/checks/*.sh` (read by the `__tests__/mutation-*`
  wrapper tests). `reports/` is deliberately kept: Stryker's incremental
  report (`incremental: true`) is read from the PROJECT ROOT and is already
  in the always-ignored set, so keeping the dir is harmless and safer than
  excluding it. `ios` stays ignored even though `__tests__/info-plist.test.ts`
  reads `ios/Kiko/Info.plist` and
  `__tests__/test-support/deployment-target.test.ts` reads
  `ios/Kiko.xcodeproj/project.pbxproj` and `ios/Podfile`: the Stryker
  jest-runner defaults `enableFindRelatedTests: true`, so only tests
  transitively importing a mutated source file run, and neither test imports
  app source — neither runs under Stryker, so the missing `ios/` in the
  sandbox never breaks them. A fixture string that jest's text scan reads as an
  import would silently break that premise;
  `__tests__/harness-tests-do-not-depend-on-src.test.ts` holds it (see the
  `GENUINE_SRC_TESTS` bullet below).
  Final confirmation of any missing-file mistake comes from the FIRST real
  mutation run after integration: Stryker runs the covering test suite once
  before mutating, so a wrongly-excluded read fails FAST with a clear
  ENOENT rather than silently corrupting the score — that fail-fast is the
  accepted safety net.
- **`GENUINE_SRC_TESTS` in `__tests__/harness-tests-do-not-depend-on-src.test.ts`**:
  the harness tests that may be related to a source file by jest's own
  `--findRelatedTests`; every other file under `__tests__/` must not be, so a
  Semgrep-spawning harness test never joins a Stryker run or its dry run. The
  test asserts the related set EQUALS this list, so a stale entry fails too.
  Two entries, each a real import of app source:
  `__tests__/App.test.tsx` renders the real root component (`import App from
  '../App'`), imports `@kiko/reminders/native` and
  `@kiko/navigation/navigation-ref`, and mocks and requires the actual
  `@kiko/accounts/accounts.repo`; and
  `__tests__/symbol-deployment-target.test.tsx` renders
  `@kiko/navigation/root-navigator` and imports `@kiko/holdings/entity-symbols`,
  `@kiko/holdings/entity-icon-pool`, `@kiko/design-system/components/icon-pools`,
  `@kiko/design-system/edit-bar-item`, and `@kiko/navigation/dark-theme`.
  Neither spawns Semgrep. A new entry needs the same: a real import of src
  logic, never a fixture string (build that specifier at runtime instead).
- **`jest.config.js` `testPathIgnorePatterns`**:
  `<rootDir>/__tests__/test-support/(?!.*\.test\.[jt]sx?$)` (beside Jest's
  own `/node_modules/` default). Jest's default `testMatch` runs every file
  under a `__tests__/` folder as a suite, so the shared harness-test helpers
  there (`mutation-repository.ts`, the throwaway git repository, stub, and
  wrapper-run helpers the mutation cap, stream, and lock tests share) would
  each fail as an empty suite. No test is skipped: the negative lookahead
  ignores only the non-test helpers, so a `*.test.*` file placed beside a
  helper in that folder still runs, and every helper is exercised by the
  suites that import it.
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
- **`.env.test` (tracked, public-only test env file)**: a committed `.env`
  variant that mirrors `.env.example`.
  `jest.config.js` defaults `ENVFILE` to it (`process.env.ENVFILE = process.env.ENVFILE || '.env.test'`),
  so a fresh checkout runs hermetic Jest tests with no hand-edited local
  `.env`; an explicit `ENVFILE` still wins. Concrete
  justification: the native-banks render tests were non-hermetic — they
  depended on a hand-edited local `.env`, so a medium-tier green on one
  machine was not proof of a fresh checkout; defaulting to a committed file
  makes them reproducible. Every value is public, non-secret config (same
  rule as `.env` — see `dependency-hygiene.md`'s "`.env` is public-only").
  Updated 2026-09-18 (Guideline 2.3.1(a), now 2.5.19, remediation, Task 1): `.env.test` no
  longer carries a `SHOW_UNREADY_BANKS`-style flag — that release-readiness
  visibility gate was removed outright, not merely defaulted off. The "add
  a bank" sheet's `visibleCatalogEntries`
  (`src/screens/account-detail/add-bank-sheet/add-bank-sheet.component.tsx`)
  now takes no flag argument: it shows every wired-registry provider in the
  catalog unconditionally, so there is nothing left for a test-env value to
  gate. See the `kiko-architecture` skill's "Guideline 2.5.19 — no hidden
  features" section for the standing rule this codifies.
- **`e2e/screenshot/` — the demo-dataset subsystem lives outside `src/`,
  and `knip.json` needs NO entry/ignore for it (2026-09-19, Guideline 2.3.1(a), now 2.5.19,
  remediation).** `src/` now has **zero** references into `e2e/`, of any
  kind — no static import, no dynamic `require`. The one dynamic `require`
  that used to reach `screenshot-seed.ts` from `MigrationsGate`
  (`src/migration/migrations-gate/migrations.gate.tsx`,
  `seedScreenshotDataIfEnabled`) was deleted outright: demo data now enters
  the app only through the real, user-visible Import UI, never a boot-time
  seed. The tightened Semgrep rule
  (`kiko-no-hidden-feature-flag-or-demo-import`, `rules/semgrep-mobile.yml`)
  enforces this for both shapes going forward — a static `e2e/` import and
  a dynamic `e2e/` `require` are both findings now, with no exemption.
  `e2e/screenshot/` still needs no `knip.json` config for the one reason
  that remains: Knip's Jest plugin already treats every file Jest's own
  (unmodified) default `testMatch` matches as an entry point, and that
  default pattern is repo-wide, not scoped to `src/` — so
  `e2e/screenshot/**/*.test.ts` (the dataset builder's, the snapshot
  mapper's, and the `.kiko` generator's colocated tests) keeps the whole
  subsystem in Knip's reachable graph without any repo-wide edit.
- **`ios/Kiko/Kiko.entitlements`'s `com.apple.security.application-groups`
  (`group.com.dmytro-vasylkivskyi.kiko`) is kept on purpose although
  currently unused (2026-09-23, user decision).** The net-worth home-screen
  widget and its `WidgetBridge` native module were removed
  (`f54ce63`, `bba473f`) and nothing in the app writes to the App Group
  today. The entitlement stays because removing it needs a NEW
  provisioning profile, and a future Share Extension entry point
  (`docs/plans/forms-bank-model.md`'s Share Extension step) is expected to
  need the same App Group to hand data to the main app. The two Semgrep
  ERROR rules that used to guard widget/App-Group Swift code
  (`kiko-widget-money-view-needs-privacysensitive`,
  `kiko-appgroup-write-needs-protection`) and their fixtures were removed
  2026-09-23 (`4e66dd7`) as dead — re-add both, with fixtures, the moment
  any code (a Share Extension or otherwise) writes to the App Group again.
- **The pre-write guard's override comment (`// nosemgrep: <rule-id>
  OVERRIDE(<reason>) <justification>`, or `kiko-override:` for a
  Node-checked rule) is the same shape as the Biome override protocol
  above, applied to `rules/semgrep-prewrite.yml` and the
  `NODE_RULES` in `scripts/checks/pre-write-guard.js`.** A bare
  `nosemgrep`/`kiko-override` comment with no `OVERRIDE(...)` never
  suppresses a finding — see `pre-write-guard.js`'s
  `OVERRIDE_COMMENT_PATTERN` and its surrounding comments for the
  exact match rule. Every `paths.exclude` scope added to
  `rules/semgrep-prewrite.yml` (one per rule, pointing at the real
  implementation a rule's own pattern would otherwise also flag) gets
  its own bullet in this file, named by the rule id, as kiko-linter's
  "Adding a pre-write guard rule" step 7 requires; the exact glob list
  lives in the comments next to the rule in that file, so read the rule
  there for it. Older rules may still have only the inline comment, and
  gain a bullet the next time their exclude changes.

- **`kiko-worklet-directive-required` (`rules/semgrep-prewrite.yml`)
  excludes every test file (`*.test.ts`, `*.test.tsx`, `__tests__/**`,
  `e2e/**`).** Jest mocks `react-native-reanimated`, so no worklet runtime
  ever captures a helper in a test file and the Release-only SIGABRT the
  rule guards against cannot happen there. The rule's `$F(...)` x
  statement-sequence match is also quadratic on a large test file whose
  "Gesture" substrings (`fireGestureHandler`, `GestureRootWrapper`) defeat
  Semgrep's prefilter: it crossed Semgrep's per-rule timeout under load, so
  the pre-write guard denied "could not check" at random. The rule's
  `rules/fixtures/` pair is not named like a test file and still proves the
  rule in `check:rules`; `__tests__/pre-write-guard-rules.test.ts` proves
  the exclusion.

- **`kiko-no-math-min-max-spread` (`rules/semgrep-prewrite.yml`) excludes
  `*.test.ts` and `*.test.tsx`.** `transaction-span.test.ts` and
  `min-max.test.ts` assert that `Math.min(...values)` throws a RangeError
  on a large array, the premise that makes `minOf`/`maxOf` necessary, so
  they must spell out the spread. `__tests__/pre-write-guard-rules.test.ts`
  proves the exclusion; the flat fixture pair still proves the rule.

- **`kiko-component-explicit-return` (`rules/semgrep-prewrite.yml`) excludes
  `*.test.tsx` and includes only `*.tsx`.** The exclude: a component local to
  a test file is scaffolding, such as the stub screen
  `const DetailScreen: FC = () => null;` in
  `large-title-heading-bar.test.tsx`, and kiko-code-style's "One component per
  file, each in its own folder" states that exemption. App components and the
  components in `src/test-support/` are not exempt. The include: the rule reads
  source text, string contents included, so a `.ts` harness test that quotes
  component source stays outside it. `__tests__/pre-write-guard-rules.test.ts`
  proves the include; the flat fixture pair proves the rule in `check:rules`.

- **`kiko-no-root-calendars-value-import` (`rules/semgrep-prewrite.yml`)
  excludes `*.test.ts` and `*.test.tsx`.** The rule exists for bundle size,
  and Jest never bundles, so a test's root import costs nothing. The
  `jest.mock('react-native-calendars', ...)` in `jest/setup.js` still
  covers any test that imports the root. The flat fixture pair proves the
  rule in `check:rules`.

- **`kiko-no-raw-error-in-console` (`rules/semgrep-prewrite.yml`) excludes
  `src/diagnostics/log-failure.ts`, `*.test.ts`, and `*.test.tsx`.**
  `log-failure.ts` is the sanitizing sink: its one `console.warn(tag, { name,
  code })` passes the `tag` parameter, an identifier, which the rule cannot
  tell from an error object. `log-failure.test.ts` pins what the sink logs
  (name and code only; a planted secret in the message never reaches the
  spy). Tests are excluded because a test's console output never ships in
  the app. The flat fixture pair proves the rule in `check:rules`.

- **`kiko-no-clipboard-set-string` (`rules/semgrep-prewrite.yml`) excludes
  `src/clipboard/copy-sensitive-text.ts`, `*.test.ts`, and `*.test.tsx`.**
  `copy-sensitive-text.ts` is the one sanctioned pasteboard write: its
  `Clipboard.setString(value)` is the call the rule bans everywhere else, so
  a later local-only, expiring copy changes only that body.
  `copy-sensitive-text.test.ts` pins that it writes the value once. Tests are
  excluded because they only drive the Jest clipboard mock and never ship.
  The flat fixture pair proves the rule in `check:rules`.

- **`kiko-no-per-bucket-date-in-statistics` (`rules/semgrep-prewrite.yml`)
  excludes `*.test.ts` and `*.test.tsx`.** The rule exists for the cost of a
  Statistics render, and test code never runs in one. A parity oracle in a
  test (the `referenceHoldingValueAt` pattern in `holding-value-at.test.ts`)
  may keep the slow per-bucket shape on purpose. Measured on 2026-09-29: the
  rule without the exclude draws 0 findings in `src/statistics` tests, so the
  exclude hides nothing today. The nested fixture pair proves the rule in
  `check:rules`.

- **`kiko-no-source-text-read-in-test` (`rules/semgrep-prewrite.yml`)
  excludes `__tests__/**`, and five tests carry one per-line override.**
  The exclude: harness tests read rules, scripts, docs, and temp projects,
  never a mutable source; their paths are mostly computed, so the rule
  would fire on nearly every one.

  Each override is a
  `// nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(<reason>)` line
  directly above the ONE read the rule cannot prove is a non-TypeScript
  fixture. None relies on text that Stryker's instrumentation
  changes. Every other read in the same file is still checked, so a new
  source-text read there is denied:
  - `src/db/settings-columns.test.ts`: reads the column names from
    `getTableColumns(settings)` and searches src text only for each
    name as a whole word; Stryker keeps every original identifier.
  - `src/i18n/locales/title-keys.call-sites.test.ts`: unwraps Stryker's
    `stryMutAct_…() ? "" : (stryCov_…(), 'key')` argument shape, and its
    own "survives Stryker mutation-testing instrumentation" case pins it.
  - `src/help/help-topics.test.ts`: reads each catalogue-key string literal in the
    app source and walks up to the prop it sits in, to find a label only an
    accessibility prop renders. Stryker keeps the original literal inside its
    `stryMutAct_…() ? "" : (stryCov_…(), 'key')` shape, so the walk from the
    literal still reaches the same prop, and the file's "reading how a catalogue
    key is used in source" cases pin that shape.
  - `drizzle/migrations/0044-move-crypto-cash-holdings.test.ts`: searches
    `drizzle/` and `src/` text for the literal `crypto-from-`; Stryker
    keeps the original string beside its mutant.
  - `e2e/screenshot/fixtures/generate-demo-kiko.test.ts`: reads its
    `.kiko` fixtures by a `fileName` from the `LANGUAGES` table, which
    the rule cannot resolve through the loop.

  The nested fixture pair proves the rule in `check:rules`;
  `__tests__/pre-write-guard-rules.test.ts` proves the scope.

- **`kiko-no-direct-notification-permission-request`
  (`rules/semgrep-prewrite.yml`) excludes `src/reminders/permission/**`,
  `*.test.ts`, `*.test.tsx`, `__tests__/**`, and `src/test-support/**`.**
  `src/reminders/permission/use-notification-permission.ts` is the one owner:
  its `request` is the call the rule points every other caller at. Tests and
  test support mock or spy on the member to drive that owner:
  `src/test-support/permission-notice-cases.ts` reads
  `jest.mocked(remindersNative.requestAuthorization)`, and
  `src/reminders/native/reminders-native.test.ts` calls the wrapper itself.
  Measured on 2026-09-30: the pattern without the excludes draws exactly
  those 3 hits in `src/` (the owner, the test-support file, and the native
  test), so the excludes hide no app caller. The flat fixture pair proves the
  rule in `check:rules`.

- **`kiko-no-fixed-day-offset-into-local-day` (`rules/semgrep-prewrite.yml`)
  excludes `scripts/**` and `harness/**`.** Both trees are harness tooling
  that never computes an app calendar day; `startOfLocalDay`/`endOfLocalDay`
  are app exports from `@kiko/dates`. Measured on 2026-09-30: neither tree
  names either function, so the excludes hide nothing today. App source and
  tests stay in scope. The flat fixture pair proves the rule in
  `check:rules`.

- **`kiko-no-local-day-length-constant` (`rules/semgrep-prewrite.yml`)
  excludes only `src/dates/**`.** `src/dates/duration.ts` declares `DAY_MS`,
  the one owner of the day length, and `src/dates/local-day.test.ts` keeps
  its own literal day as an oracle independent of that constant (a test of
  the owner that imported `DAY_MS` would prove nothing about it). App source,
  tests, test support, and `e2e/` are all in scope. The one false positive in
  tests is a keyed timestamp of epoch + 1 day in a fixture object
  (`{ t: 86_400_000 }`, `{ day: 86_400_000 }`), the only two keys the tree
  uses that way. The rule skips a day literal inside an object literal that
  holds a day literal under the key `t` or `day`, and the negative fixture
  pins both shapes; any other key (`{ ttlMs: 86_400_000 }`) still fires, a
  bad-fixture pin. Known limit: the skip is by range over that whole object,
  so a span beside the keyed literal in the same object
  (`{ t: 86_400_000, cutoff: now - 86_400_000 }`) does not fire either.
  Measured on 2026-10-01: without the
  exclude the rule draws 2 hits in `src/dates/` and 0 anywhere else, after a
  sweep of 49 sites in 40 files (39 test files and
  `e2e/screenshot/seed/screenshot-seed.ts`) to `DAY_MS`. The flat fixture
  pair proves the rule in `check:rules`; the scope probes in
  `__tests__/pre-write-guard-rules.test.ts` prove the test, test-support,
  `e2e/`, and `src/dates/` paths.

- **`kiko-holding-delete-needs-cascade` (`rules/semgrep-prewrite.yml`)
  excludes `src/transactions/repo/transactions.repo.ts`,
  `src/holdings/repo/holdings.repo.ts`, `*.test.ts` and `*.test.tsx`.**
  `holdings.repo.ts` defines `removeHoldingDatabaseTransaction` and
  `transactions.repo.ts` is its one caller, which runs it right after the
  cascade in `transactionsRepo.removeHolding`: the rule would fire on its
  own owner. Test files may exercise the helper directly (a unit test of its
  synced-holding refusal); none calls it today (grep, 2026-10-05). Measured on
  2026-10-05: without the excludes the rule draws two hits, the definition in
  `holdings.repo.ts` and the call in `transactions.repo.ts`, and none
  elsewhere in `src/`. The flat fixture pair
  proves the rule in `check:rules`.

- **`kiko-no-whole-price-points-read` (`rules/semgrep-prewrite.yml`)
  excludes `src/prices/use-price-book/**`, `src/prices/price-points-repo/**`,
  `*.test.ts` and `*.test.tsx`.** The hook's folder is where
  `usePriceBook` reads `pricePointsRepo.allQuery()` for a history screen, and
  the repo's folder defines `allQuery` and the filtered selects: both are the
  rule's owners, so the rule would only fire on its own definitions. Test
  files mock or call the whole-table read to prove the current-rows book gives
  the same numbers. Measured on 2026-10-02: without the excludes the rule draws
  hits only in those folders and tests, plus the two overridden sites
  (`statistics.screen.tsx`, `read-snapshot.ts`), each with a per-line
  `nosemgrep ... OVERRIDE(...)` in the source, never a file exclude. The flat
  fixture pair proves the rule in `check:rules`.

- **`readAllRulesDatabaseTransaction`
  (`src/categories/category-rules-repo/category-rules.repo.ts`) reads the whole
  `category_rules` table inside `write()`, with no `where` and no cap.**
  Callers inside a write: `saveRule` and `applyNameRule` (once each) and
  `withCategoryRules` in `src/transactions/repo/transactions.repo.ts` (once per
  insert batch). `kiko-no-full-table-select-in-write`
  (`rules/semgrep-prewrite.yml`) matches only a literal `write(...)` callback
  body, so the helper is invisible to it and there is no inline `nosemgrep`;
  this entry is the record. Safe because the table is user-authored (one row
  per rule) and small, and every reader needs every rule: a `where` or a cap
  would silently drop a rule, a category not applied (spec decision 10, no
  known limit for data correctness). Bounded: read once per write
  (`stageDraft`) and once per insert batch, never per row; transaction rows
  are paged. Any new whole-table reader inside a write needs its own entry.

- **`src/native-specs/Native*.ts` (`NativeKikoReminders.ts`,
  `NativeDisplayRegions.ts`) — the only PascalCase `.ts` file names in
  `src/`, in a folder with no barrel.** React Native codegen reads a spec
  file only if its basename matches `/^(Native.+|.+NativeComponent)/`
  (case-sensitive) and has exactly one dot (see `filterJSFile` in
  `node_modules/@react-native/codegen/lib/cli/combine/combine-utils.js`),
  so the name cannot be kebab-case. `package.json` `codegenConfig.jsSrcsDir`
  points at that folder. A barrel there would call
  `TurboModuleRegistry.getEnforcing` on load, so `feature-imports.js`
  (`NATIVE_SPEC_PATTERN`) treats `native-specs/**` as barrel-less: the folder needs no
  `index.ts` and a spec is imported deep through the alias. Only each module's
  wrapper (`reminders-native.ts`, `display-regions-native.ts`) loads its spec
  (lazily, via `require`); the
  `kiko-no-native-reminders-module-import` and
  `kiko-no-native-display-regions-module-import` Semgrep rules
  (`rules/semgrep-prewrite.yml`) deny any other value import. Add another
  `Native*` spec only for a new app TurboModule.

- **`src/design-system/components/screen/**` — the owner folder of
  `kiko-no-pane-blind-bottom-clearance`'s `paths.exclude`.** The rule denies
  importing `resolveBottomClearance` (or its `bottom-clearance` module) so a
  `bleedBottom`/`bleedTop` child takes the pane-aware `useBottomClearance()`
  instead. The Screen folder is the one place that may: `use-bottom-clearance.ts`
  imports the function, and `bottom-clearance.test.ts` tests it. A whole-folder
  exclude is right here because every file in it is part of the sink; the rule
  still reaches every consumer (Home, HoldingDetail).

- **`src/design-system/components/screen/**` and
  `src/design-system/components/two-pane-layout/**` — the two folders
  `kiko-top-bar-band-only-in-two-pane-layout`'s `paths.exclude` lists.** The rule denies
  importing `useTopBarBand` (or its `use-top-bar-band` module): a screen that adds the band
  inside a pane counts it twice, because `TwoPaneLayout` already starts each pane frame below
  it. The Screen folder owns the hook (`use-top-bar-band.ts` and its test), and
  `two-pane-layout.component.tsx` is its one consumer. A whole-folder exclude is right for
  both because each holds only the hook's owner or its sanctioned consumer and their tests;
  the rule still reaches every other importer.

- **`sf-symbols-typescript` — a transitive package read by path in a test,
  invisible to depcheck and Knip.** `__tests__/test-support/sf-symbol-catalogue.ts`
  reads `node_modules/sf-symbols-typescript/dist/index.d.ts` as text, because
  the package is type-only (it exports no runtime value) and its SF Symbols
  availability data lives in that declaration file. The package is not in
  `package.json`: two packages depend on it (`@react-navigation/native-stack`
  `^2.1.0` and `react-native-bottom-tabs` `^2.0.0`), and `package-lock.json`
  locks it at 2.2.0. depcheck and Knip see no import of it, so neither
  reports it. A missing or reshaped file (a dependant dropped, the package
  moved or its comments changed) fails `__tests__/symbol-deployment-target.test.tsx`,
  `sf-symbol-catalogue.test.ts` and `deployment-target.test.ts` loudly, never silently. If a dependant
  stops installing it, add it to `package.json` as an exact-pinned
  devDependency instead.

- **`scripts/checks/commit-typecheck.sh` docs-only skip.** The pre-commit typecheck exits 0
  without a run when the staged diff (renames listed under both names) touches no file whose name
  ends in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, or `.json` (the
  `SOURCE_FILES` pattern in that script). Reason: tsc reads only those files and `node_modules`,
  which follows `package.json` and `package-lock.json`, so the result then equals HEAD's. Only a
  clean "no match" skips: a failed diff or a grep error runs the check.
- **`scripts/ensure-git-hooks.sh` skip outside a repository root.** The `postinstall` step exits 0
  without setting core.hooksPath when `git rev-parse --show-toplevel` fails (no repository: a
  scratch copy without `.git`, a source tarball), or when the top level is not the folder that
  holds the script (a copy inside another repository, whose config it must not change). Reason:
  no commit is possible from there, so there is nothing to guard. A config it cannot read, a
  write that fails, or a core.hooksPath that already holds another value is not skipped: it
  prints the standard block and exits 2.
- **`__tests__/skill-identifiers.test.ts`'s two exemption lists (non-project
  names, and bad-name examples per skill file).** The test fails when an inline code span in a
  skill or agent file names an identifier that no word of the code corpus
  matches (see kiko-linter's paragraph on this test, next to the one on
  `__tests__/cited-paths.test.ts`), so a name that is not this repository's own code must be listed. Each
  entry is a name the skills cite on purpose that the repository never
  contains, by category (a category's reason is verified when it is added):
  library and runtime internals cited to explain a behavior (react-native,
  react-native-sortables, RNGH, Unistyles, drizzle, a clipboard hook,
  jest-haste-map), Apple names `ios/` does not use (UIKit; the built
  Info.plist's `UIDeviceFamily`, which the source plist lacks), the
  `Intl.Locale` week getter, fnts exports and type parameters, a TypeScript
  option that `@react-native/typescript-config` sets (`isolatedModules`;
  `tsconfig.json` extends it and never spells it), a SQL keyword, shell and OS
  tools plus a python module and a node API named in the kill-guard limits,
  `du` and `curl` as the auditor and researcher agent files name them, Semgrep
  taint and `--time` keys, the run log's `summary.json` and `run.json`
  (written under `~/.claude/harness-runs`, outside the repository), a
  conventional-commit scope word, a Claude Code
  tool and a devicectl field, and the drizzer14/harness repo's own config
  file, keys and env var. A deliberate bad-name or bad-id example, a placeholder (`isX`,
  `vX.Y.Z`) and a React DevTools label (`Anonymous`) are exempt per
  `(skill file, name)` pair, not by name alone, like the
  `full-word-identifiers` `EXEMPTIONS` above: the same name cited as a real
  symbol in another skill must still resolve. The test also fails on an
  entry that is no longer cited or now resolves, so the lists only shrink.
  A name that left the code is fixed in the skill text (renamed, or written
  without backticks), never added here.

- **`scripts/checks/medium.sh` repeated-Stop skip** (user ruling Q2 A,
  2026-10-13, confirmed in the orchestrator's terminal): on a repeated Stop
  (payload `stop_hook_active: true`) the tier writes `medium tier: skipped on
  a repeated Stop` to stderr and exits 0. Reason: a failing Stop started a
  new turn that ended in the same failure and the orchestrator looped (knip
  ran about 8 times, binance-history-a7, 2026-10-11). Cost: a repeated Stop
  shows a failure once; the next first Stop and `check:all` still catch it.
  Scope: Stop only, never SubagentStop, only when stdin is a regular file; an
  unreadable payload runs the tier as before.
- **`scripts/job-queue.sh` power rule**: a missing `pmset` binary means AC
  power (every other unreadable state holds). Reason: a machine without
  `pmset` has no battery, so a hold would block forever. Risk: a Mac whose
  `pmset` is not on PATH.
- **`scripts/job-queue.sh` group TERM** (user ruling A, 2026-10-13): the
  queue may send TERM to the process group it created for its own job, never
  any other group; see kill-guard's entry above.
- **`__tests__/error-class-pins.test.ts` skips a class with an empty body**
  (`class X extends Error {}`): such a class inherits its name and message
  from `Error` and has no own `.name` or `.message` literal to pin, and
  pinning it would need a `src/` change that adds one. Every non-empty
  `extends Error` class is checked, with no per-class exemption list.
- **`__tests__/docs-known-limit.test.ts`'s exact-path list (`PREDATING_DOCS`).** The test
  fails when a plan or a spec under `docs/superpowers/` uses the phrase "known limit" or
  "known limitation", because a gap filed that way ships with no owner. Two dated reminders
  docs hold the phrase and are exempt by exact path, each pinned to its count of matches:
  `docs/superpowers/plans/2026-09-28-reminders.md` (1) and
  `docs/superpowers/specs/2026-09-27-reminders-design.md` (2). Reason: both are dated history
  that predates the rule, and rewriting a dated record would falsify it. The exact-count
  test pins each count, so a doc that gains or loses a match fails; the list only shrinks and
  a new doc is never added.

- **`scripts/checks/comment-line-width.pinned`**: exact comment lines over 100 columns that
  cannot wrap (rows `<path><TAB><exact line>`; currently empty: `COMMENT_PIN_CEILING` is 0 in
  `__tests__/pin-count-ceilings.test.ts`). Reason: a
  fixture line that is itself the probe, or a line whose wrapping would change what the
  rule under test sees. The list only shrinks: a row whose line is gone or now fits fails as a
  stale pin, and a line that can wrap is wrapped, never pinned.
- **`__tests__/fixtures/markdown-prose-width.pinned.json`**: exact markdown prose lines over 100
  columns in the skill, agent and harness docs, keyed `path -> [line text]`. Reason: these
  lines predate the prose-width rule, and rewrapping them all in one change would bury the
  content diff. `__tests__/markdown-prose-width.test.ts` fails on a stale pin, so the list only
  shrinks: rewrap a pinned line and delete its pin; a new line is never pinned.
- **`harness/kiko/scripts/run-log.mjs` is outside `check:comment-line-width`**: the script must
  stay byte-identical with the copy in the harness repository, so wrapping its comments
  here would fork the two. `scripts/checks/comment-line-width.sh` names the exclusion in its
  header.

- **User ruling 2026-10-14 (G1 a): a comment-only source with a changed colocated test mutates
  nothing.** A source file that `comment-only-changes.js` proves comment-only prints
  `skipped (comment-only): <path>` and is not mutated, whatever its colocated test did; the
  whole-file keep (its `--list` keep line) is removed from `mutation.sh`. A real change
  with a changed test still mutates its changed-line ranges; a Stryker or JSX pragma comment, a
  missing `typescript`, or any doubt keeps the file. Cost: a test weakened beside a
  comment-only source edit is not mutation-checked; `make verify` still runs it.

- **`medium.sh` doc step deadline exit (2026-10-15)**: at hookStarted + the budget that
  `node scripts/checks/guard-replay.js step-budget` prints, the doc step stops its own jest pid
  and exits 2 with a block telling the agent to run `make doc-suites` by hand.
  Reason: the 300 s hook limit would otherwise kill the Stop tier with no block. Zero
  discovered suites, a missing jest, an unreadable budget or a fingerprint hash failure
  while doc files or suites exist also exit 2 (fail-closed).

- **patch-package patches (`patches/`, applied by `postinstall`)**: five patches edit
  `node_modules` after `npm ci`; re-check each on upgrade of its package.
  - `patches/react-native-screens+4.27.0.patch` (`react-native-screens@4.27.0`: the iOS
    `RNSScreenStack` header and implementation, the codegen spec `ScreenStackNativeComponent.ts`,
    `contexts.tsx`, `ScreenStack.tsx` and `index.tsx` of the package's own `src`, and the
    `lib/commonjs` and `lib/typescript` copies of them, which Jest and `tsc` load): a pane's
    native large title lines up with its content. UIKit insets the large title by the navigation
    bar's layout margin, which it derives from the stack's distance to the window's edge (20 pt
    for the pane at the window's leading edge, 0 for the other pane), while the content pads its
    sides by a fixed 16 pt. The patch adds a `fixedContentMargin` prop (a Float, default 0) to
    `RNSScreenStack`, a `FixedContentMarginContext` (default 0) that `ScreenStack` reads and
    passes as that prop, and on iOS a `fixedContentMargin` property on `RNSNavigationController`.
    While it is above 0 the controller stops respecting the system minimum layout margins and
    sets the leading and trailing margins of its view and of its navigation bar to that value,
    again after each `viewDidLayoutSubviews`.
    Scope: only `PaneStackView` in a split (`columns`/`rows`) of a large window (regular, shorter
    side >= 721, `useIsLargeWindow`) provides a value (`theme.spacing(4)`, the content's side
    padding), around both panes' stacks. Every other stack (iPhone, single-pane, a stack outside
    `PaneStackView`) and the panes of a Surface Duo inner window (951x669, 669x951), which keeps
    its look completely, read 0. How the default path
    stays the same: with 0 the `updateProps` compare is equal so the setter never runs,
    `applyFixedContentMargin` returns on its first line, and no margin or
    `viewRespectsSystemMinimumLayoutMargins` is touched; the native stack gets the prop's codegen
    default. Going back to 0 (a recycled stack view) restores the view and bar margins captured
    when the value first went above 0, and `viewRespectsSystemMinimumLayoutMargins = YES`. Only
    the Fabric (new architecture) path is patched, as the stack takes its props in
    `updateProps`; `lib/module` is not patched (nothing here loads it). The patch was derived
    against the pristine tarball (`npm pack react-native-screens@4.27.0`): applying it to that
    tarball gives the installed tree.
    Pinned by `__tests__/react-native-patch.test.ts` ("the react-native-screens fixed content
    margin patch": the patch touches only react-native-screens, the version is exactly `4.27.0`,
    the installed files carry the patch, and the context reads 0 outside a provider) and by
    `pane-stack-view.component.test.tsx` (both panes get `theme.spacing(4)`, the single stack 0).
    Re-check rule: `docs/harness/dependency-hygiene.md` ("Standing patch: react-native-screens").
    A device re-measurement is the real proof (Jest cannot see native margins).
  - `patches/react-native+0.87.1.patch` (`react-native@0.87.1`,
    `RCTScrollViewComponentView.mm` only): D1. The native keyboard handler of every
    `ScrollView` with `automaticallyAdjustKeyboardInsets` shifted its content offset by the
    keyboard height for a field OUTSIDE it (the outside-field `inputAccessoryView` branch). The
    patch drops that branch, so an offset moves only for a field inside the scroll view; the
    inset math is unchanged. It fixes the Duo/iPad two-pane blank pane (a field in one pane
    moved the other pane's list) and the same shift of a Screen covered by a pushed form.
    Pinned by `__tests__/react-native-patch.test.ts` ("the React Native ScrollView keyboard
    patch": the patch touches that one file, `react-native` is exactly `0.87.1`, the installed
    file has the guard). A React Native upgrade fails that pin: re-check the patch then.
  - `patches/react-native-nitro-sfsymbols+2.0.0.patch` (`react-native-nitro-sfsymbols@2.0.0`):
    the diff adds two lines to `init` of the generated `HybridNitroSfsymbolsComponent.mm`,
    setting `_props` to a static default `HybridNitroSfsymbolsProps` before `updateView` runs.
    The diff does not state why; it gives the view non-null props from its first
    `updateView`.
  - `patches/read-excel-file+9.3.10.patch` (`read-excel-file@9.3.10`, its `commonjs` and
    `modules` `zip/unzipFromArrayBuffer.js`): `unzipAsync` calls `fflate`'s `unzipSync`
    instead of the async `unzip`. The diff's own comment: async `unzip` does `new Worker(...)`
    for an entry that decompresses to 512 KB or more AND compresses to under 80% of its
    original size, Hermes has no `Worker` global, so it threw `ReferenceError` on device (never
    under Jest).
  - `patches/@stryker-mutator+jest-runner+8.7.1.patch` (`@stryker-mutator/jest-runner@8.7.1`,
    `dist/src/jest-test-runner.js` and `dist/src/jest-plugins/mixin-jest-environment.cjs`): a
    mutant run selects its covering tests exactly instead of through one `testNamePattern` regex
    per mutant, which timed out on regex cost alone above a few hundred covering tests. Pinned
    by `__tests__/stryker-jest-runner-patch.test.ts` and the `scripts/checks/mutation.sh`
    preflight; full rule in `docs/harness/dependency-hygiene.md` ("Standing patch").
