# Documented exceptions (harness ignore-lists and suppressions)

> Reference detail moved out of CLAUDE.md (2026-09-15) to keep the root harness doc lean. CLAUDE.md points here. This is the authoritative content; edit it here.


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
  (`import { PRICE_ENDPOINT } from '@env'` in `src/rates/coingecko/coingecko.ts`);
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
  10.14%, `sync.test.ts` 7.67%, `statistics.screen.test.tsx` 7.38%,
  `net-worth-series.test.ts` 7.25%, `restore-snapshot.test.ts` 7.21%,
  `import-statement.test.ts` 7.09%, `account-form.screen.test.tsx` 6.88%,
  `transactions.repo.remove-cascade.test.ts` 5.91%, `holdings.repo.test.ts`
  5.75%, `holding-form.screen.test.tsx` 5.63% (every non-test source file over
  the limit is under 2%). A second figure is tracked beside the per-file ones:
  one more run measures the whole scope TOGETHER with the limits raised,
  because a clone between a large file and another file is invisible to the
  alone runs. Its baseline on 2026-10-11 is 7.33% of lines, against 3.24% for
  the blocking run with the default limits, and it applies to the no-argument
  (whole-repo) run only: a scoped run's combined figure is not comparable; a warning for a combined total
  above the threshold is expected until the sweep lands, and a figure above
  7.33% is a new regression. **Flip condition:** a separate sweep track makes
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
  into `src/`, `__tests__/`, `rules/`, or `e2e/`, and a while/until process-scan
  wait loop (see CLAUDE.md's "Automatic wiring" and
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
  write when it introduces a known violation (see CLAUDE.md's "Automatic
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
  build (kiko-compliance 5.6). Each entry and its reason:
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
  identifier chosen freely in the SAME file (`BinanceTransactionSyncDeps`, this
  codebase's own type name, correctly renamed to `BinanceTransactionSyncDeps`
  during the R1.d sweep — a word-only, file-wide exemption would have
  silently skipped that one too). Each of the 20 entries is a real,
  verified external-format mirror, not a style preference:
  `src/db/run-migrations.ts` + its test + the six
  `src/db/schema.*.test.ts` fixtures (`idx`) mirror drizzle-kit's own
  generated `_journal.json` `{idx, when, tag}` shape, which this runner
  reimplements byte-for-byte (see the file's own header comment);
  `src/bonds/nbu-register/nbu-register.ts` + its test (`val`, from
  `val_code` and from `payments[].pay_val`) mirror the National Bank of
  Ukraine securities register's own external JSON fields; `src/crypto-sync/binance/binance.client.ts` +
  its test (`msg`) mirror Binance's own error-body shape `{code, msg}`;
  those same two files plus `binance.transactions.ts`/`.test.ts` (`tx`,
  from `txId`) mirror the literal field name on Binance's deposit/withdraw
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
  deliberately non-conforming, never-imported code (a hidden Guideline 5.6
  feature flag import, a Keychain secret pushed into React state), and each
  pair is near-identical by construction — the negative fixture
  is the positive one plus the fix. Verified: without these exclusions a
  `.bad.tsx` fails Biome, reads as an unused file to Knip, and a pair reports
  40% duplicated lines / 43.71% duplicated tokens to jscpd, all by design.
  The
  semgrep `--exclude` is the bare directory name `fixtures` (semgrep matches it
  per path component), so it hits only `rules/fixtures`; the app's own
  `src/**/__fixtures__` stays in scope. No coverage is lost:
  `npm run check:rules` (`scripts/checks/semgrep-rules.sh`) is the check that
  DOES scan the directory, and it fails if any rule stops matching its positive
  fixture or starts matching its negative one.
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
  allowlist**: the CHANGE-SET mutation gate (CLAUDE.md's
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
  Updated 2026-09-18 (Guideline 5.6 remediation, Task 1): `.env.test` no
  longer carries a `SHOW_UNREADY_BANKS`-style flag — that release-readiness
  visibility gate was removed outright, not merely defaulted off. The "add
  a bank" sheet's `visibleCatalogEntries`
  (`src/screens/account-detail/add-bank-sheet/add-bank-sheet.component.tsx`)
  now takes no flag argument: it shows every wired-registry provider in the
  catalog unconditionally, so there is nothing left for a test-env value to
  gate. See the `kiko-architecture` skill's "Guideline 5.6 — no hidden
  features" section for the standing rule this codifies.
- **`e2e/screenshot/` — the demo-dataset subsystem lives outside `src/`,
  and `knip.json` needs NO entry/ignore for it (2026-09-19, Guideline 5.6
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
  implementation a rule's own pattern would otherwise also flag) is
  documented inline in that file's own comments next to each rule —
  read the rule there rather than duplicating the list here, since a
  new rule's exclude would otherwise drift this bullet out of date.

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
  excludes `__tests__/**`, and four tests carry one per-line override.**
  The exclude: harness tests read rules, scripts, docs, and temp projects,
  never a mutable source; their paths are mostly computed, so the rule
  would fire on nearly every one.

  Each override is a
  `// nosemgrep: kiko-no-source-text-read-in-test OVERRIDE(<reason>)` line
  directly above the ONE read the rule cannot prove is a non-TypeScript
  fixture. None of these reads parses text that Stryker's instrumentation
  changes. Every other read in the same file is still checked, so a new
  source-text read there is denied:
  - `src/db/settings-columns.test.ts`: reads the column names from
    `getTableColumns(settings)` and searches src text only for each
    name as a whole word; Stryker keeps every original identifier.
  - `src/i18n/locales/title-keys.call-sites.test.ts`: unwraps Stryker's
    `stryMutAct_…() ? "" : (stryCov_…(), 'key')` argument shape, and its
    own "survives Stryker mutation-testing instrumentation" case pins it.
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

- **`src/reminders/native/NativeKikoReminders.ts` — the only PascalCase
  `.ts` file name in `src/`.** React Native codegen reads a spec file only
  if its basename matches `/^(Native.+|.+NativeComponent)/`
  (case-sensitive) and has exactly one dot (see `filterJSFile` in
  `node_modules/@react-native/codegen/lib/cli/combine/combine-utils.js`),
  so the name cannot be kebab-case. `package.json` `codegenConfig.jsSrcsDir`
  points at that folder. Only `reminders-native.ts` loads it (lazily, via
  `require`), and the barrel does not export it; the
  `kiko-no-native-reminders-module-import` Semgrep rule
  (`rules/semgrep-prewrite.yml`) denies any other value import. Add another
  `Native*` spec only for a new app TurboModule.

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

- **`__tests__/docs-known-limit.test.ts`'s exact-path list (`PREDATING_DOCS`).** The test
  fails when a plan or a spec under `docs/superpowers/` uses the phrase "known limit" or
  "known limitation", because a gap filed that way ships with no owner. Two dated reminders
  docs hold the phrase and are exempt by exact path, each pinned to its count of matches:
  `docs/superpowers/plans/2026-09-28-reminders.md` (1) and
  `docs/superpowers/specs/2026-09-27-reminders-design.md` (2). Reason: both are dated history
  that predates the rule, and rewriting a dated record would falsify it. The exact-count
  test pins each count, so a doc that gains or loses a match fails; the list only shrinks and
  a new doc is never added.
