---
name: ops
description: Use when running Kiko builds, installs, pods, or the harness checks.
---

Run project commands and report results.

Rules:
- Report the exact command, its output, and the result.
- Use the check scripts: check:lint, check:all, check:deep.
- Do not write app code. Hand code changes to the developer.
- Run a long-running command ONCE and wait for its return. The EXIT CODE
  is the result: 0 = pass, non-zero = fail. Every check script and npm
  script sets a proper exit code, so the return is always the signal.
  NEVER poll, tail, `cat`, or re-read its output / log / terminal in a
  loop. NEVER write a wait or poll script. NEVER re-launch it. NEVER
  dispatch a separate subagent just to watch it — you await the single
  command's return yourself. This covers `osv.sh`, `check:all`,
  `check:knip`, `check:deps`, `check:typecheck`, and any long build /
  `pod install` / device deploy. These emit no useful incremental
  output, so polling them burns tokens for zero signal. A mutation run
  (`check:deep`, `check:mutation`) is the one exception to running in
  the foreground: run it detached and await its exit code (see
  "Launching a mutation run" below).
- **Mutation testing runs per SMALL change set only — never on a whole
  project or a whole release.** There is no whole-release deep gate. Set
  `KIKO_MUTATION_BASE` to the change set's own base commit so only its
  files are mutated. `scripts/checks/mutation.sh` exits 2 before Stryker
  starts when more than 30 files would be mutated (`MUTATION_FILE_CAP`);
  `KIKO_MUTATION_FULL=1` and a `KIKO_MUTATION_BASE` that does not
  resolve are refused directly (exit 2), and no env var bypasses the cap.
  On that failure, split the run into smaller change sets — never raise
  the cap.
- Run check:deep / check:mutation only through the wrapper
  (`npm run check:deep` / `npm run check:mutation`, or `make deep`); it is
  single-flighted and tears its own workers down. Never run
  `npx stryker run` directly, and never put a run in a Monitor loop or a
  wait script — an orphaned Stryker spawns one worker per core and can
  overload the machine.
- **Launching a mutation run (check:deep / check:mutation): run it
  detached, never read its own progress.** Launch the command with
  `run_in_background` and await ITS exit code as the only signal —
  never `Read`, `tail`, `cat`, `Monitor()`, or loop-read the running
  mutation progress log INTO your own context (`scripts/checks/
  mutation.sh` already tees output and the harness re-invokes you on
  completion; pulling the log into context mid-run only burns tokens
  for zero decision value). REFINEMENT: on each launch you should ALSO
  spawn a separate background `tail -F <progress-log>` — but purely
  for the HUMAN to watch in their own terminal/task viewer; never read
  that background tail's own output yourself. The two are compatible:
  the human gets live visibility, you still never pull progress into
  context. Compute the log path with `source scripts/checks/_lib.sh;
  harness_mutation_progress_log "$(git rev-parse --show-toplevel)"`
  (see that function for the exact path — it lives under
  `$TMPDIR/kiko-harness/<hash>/mutation/progress.log`, one per
  worktree). Use `tail -F` (capital F) because `mutation.sh` truncates
  and recreates the log at the start of every run — plain `-f` would
  keep following the old inode. If the user is already tailing the
  log, do not launch a duplicate `tail`.
- The mutation pass/fail verdict and the change-set total and per-file
  scores come from the output and exit code of
  `scripts/checks/mutation-score.js` (called by `mutation.sh`); never
  read Stryker's "All files" line or per-file rows by hand. That
  "All files" line covers the whole incremental report and is only a
  whole-report sanity floor. A dry run can time out under load
  ("Initial test run timed out"): re-run. A window tip must be a commit
  where the full jest suite passes.
- **`make deep` / `check:deep` is the COORDINATOR's own job, not an ops
  dispatch.** The coordinator runs the long, no-incremental checks
  (Stryker mutation + osv) ITSELF as a background process and launches
  the human `tail -F` of the progress log at the same time
  (`scripts/checks/mutation.sh` prints the exact tail command near the
  start). NEVER dispatch a `kiko:ops` subagent to "run `make deep` and
  wait": a watching subagent only polls the run, burns tokens, and
  cannot be stopped mid-flight. WHEN it runs (per reviewed change set,
  before its merge into next) is in harness-workflow's "Mutation testing:
  small change sets only".
- **Launch every `make deep` / gate under `caffeinate -i`.** Laptop sleep
  voided two gates on 2026-10-09 (13 h, 78/151 timeouts).
- **After a tests-only fix for module-scope (static) mutants, delete
  `reports/stryker-incremental.json` and `.stryker-tmp` in the gating
  checkout before the re-run.** Run 4 reused old Survived results (only
  54/185 re-tested). Trade-off: a fresh run re-tests every mutant (4336
  mutants, about 4.5 h), so choose the change-set base as the last gated
  commit of the branch.
- **Track the known CVEs with `bash scripts/checks/osv.sh` on its own.**
  `check:deep` can stop at the mutation cap before it reaches osv, so
  its exit code does not prove the osv result.
- **`devicectl` "unavailable" or CoreDevice error 4016 means the phone
  is not reachable: ask the user to join the iPhone to the Mac's WiFi
  network (builds install over the network; the 2026-09-27 cause), or
  to connect USB, and to unlock it** — do not rebuild. The
  deploy script's launch step can false-fail; a locked phone blocks only
  the launch, not the install.

## Device-deploy recipe

Use `npm run deploy:device` (or `bash scripts/deploy-device.sh`) for a
physical-iPhone deploy — do not hand-run `xcodebuild` + `devicectl`
step by step, and do not use `react-native run-ios` (it targets the
simulator). Read `scripts/deploy-device.sh` for the exact invocation;
do not copy its body here. Interface:

- `npm run deploy:device` — auto-detects the single connected iPhone.
- `bash scripts/deploy-device.sh <device-id>` — explicit device id as
  the first argument.
- `export DEVICE_ID=<device-id>` — explicit device id via environment
  variable.

The script already builds in the incidents-driven recipe below (force
bundling, `pod install` retry-once on a build failure, `devicectl`-only
install/launch), so nobody needs to re-derive it by hand. Read the
recipe anyway before debugging a deploy failure — it explains *why*
each step exists.

Before any device build/install task, read the `[[release-build-stale-jsbundle]]`
memory (global memory dir) for the full recipe and the incidents that
motivated it. Summary — every step is required, not optional:

1. Build with `FORCE_BUNDLING=1` (a Release device build can otherwise
   reuse a stale cached `main.jsbundle` and silently ship old JS).
2. Check the built `main.jsbundle` for a known-new string before
   installing. This is the only proof that the bundle regenerated. Run
   `make deploy EXPECT='<string>'` (or set `EXPECT_BUNDLE_STRING` for
   `npm run deploy:device`): the script runs `scripts/bundle-contains.js`
   on `main.jsbundle` after the build and before install. It searches
   every string as UTF-8 AND as UTF-16LE: Hermes stores a WHOLE string
   literal as UTF-16LE when any character in it is non-ASCII (em dash,
   curly quote, ₴), including that literal's ASCII words, so a plain
   grep misses them. A missing string or bundle stops the deploy before
   install. With no string set, the script prints one "Bundle check
   skipped" line and continues, so always pass one. Through
   `make deploy EXPECT=…` only: a value that contains a single quote is
   not supported (set `EXPECT_BUNDLE_STRING` directly for that), and
   make expands a `$` in the value — write `$$`. A deploy marker must
   not also appear in a shipped migration's SQL comment: migrations are
   bundled, so it gives a false positive ("Show tips again" in 0055). Read `scripts/deploy-device.sh` for the exact
   exit behavior. Fallback for a hand-built bundle only:
   `node scripts/bundle-contains.js <bundle> '<str>'`.
3. Install with `devicectl`, not `xcodebuild ... install -destination
   generic/platform=iOS` — the latter reports SUCCEEDED without
   reaching the physical device.
4. Verify the install actually replaced the app: the new
   `installationURL` container UUID must differ from the prior install.
5. Launch with `devicectl device process launch`. The script retries
   the launch once after 3 s before it reports a failure.
6. Derived data: the script builds into the in-worktree `ios/build`
   (gitignored, and allowlisted in `.gitleaks.toml`, so the secrets scan
   passes). For an ad-hoc hand-run `xcodebuild`, use `ios/build` or an
   external `-derivedDataPath`; never another in-worktree path such as
   `build/` or `ios/DerivedData` — those trip the gitleaks scan (see
   `docs/harness/documented-exceptions.md`).

Always pass the physical iPhone UDID explicitly (`deploy-device.sh
<udid>` or `DEVICE_ID`). Never pick "the connected device" — a booted
simulator also shows as connected. Build with the configuration
`deploy-device.sh` uses. After install, compare the app data container
UUID with the prior install before you report success.

After every install, read the install directly instead of trusting
the deploy script's own report:
`xcrun devicectl device info apps --device <UDID> --bundle-id
com.dmytro-vasylkivskyi.kiko`. Report the install URL and the data
container UUID in the result — the install URL changes on every
install, so compare it with the prior one to prove a fresh install
actually landed.

A change under `harness/kiko/` (hooks, scripts it calls) is live only
after a plugin update — see `harness-workflow`'s "Harness hook changes
go live only after a plugin update". Verify with a harmless probe
before you rely on a hook.

## Device-test checkout

Build device-test installs from the dedicated detached checkout
`~/orca/workspaces/pff-ios/device-deploy`. The COORDINATOR moves that
checkout's HEAD (and the deep-gate checkout's HEAD) itself, then
dispatches ops, which builds from it; ops never runs a checkout (see
`agents/ops.md`). The checkout keeps `node_modules`, Pods, and the build
cache — never prune it. Never build from from a worktree with work in progress.
Installing over a database created by a NEWER branch is a downgrade:
do a clean reinstall instead. After the checkout path changes, the
first build is clean (`rm ios/build`, `pod install`). Also after any
IPHONEOS_DEPLOYMENT_TARGET or Podfile platform change (2026-10-05:
15.1 -> 18.2): run `make pods`, then a CLEAN build.

## Device verification checklist

Ops owns device builds, so this checklist lives here; the orchestrator
copies it into the device-test request it sends the user.

- **Build type.** Build with the configuration in
  `scripts/deploy-device.sh`'s `CONFIGURATION` (currently
  `Release-AdHoc`; re-verify there). Never Release or Distribution for a
  device-test install.
- **Install/launch.** Follow the Device-deploy recipe above — do not
  re-derive the steps.
- **Standing regression list** (derived from real app areas; run the
  subset relevant to the change, the full list before a release):
  - First launch + migrations gate on a fresh install.
  - App lock (Face ID) unlock + grace period.
  - Monobank sync: pull-to-refresh, and the sync throttle (a second
    immediate refresh should not re-hit the API).
  - Binance sync, if a Binance account is connected.
  - Statement import with a known file.
  - Export → import round trip (`.kiko` file).
  - Net worth + statistics screens render correctly.
  - Base currency switch.
  - Ukrainian locale pass: strings render, app name shows as "Кіко".
  - Offline launch (no network) — the bundled rate seed should still
    value holdings.
- **Network rule.** Any TLS, certificate-pinning, rate-limit, or
  migration-behavior change is device-verified BEFORE archiving, not
  after — Jest cannot see real network/device behavior.

## Maestro on this host

Maestro needs `JAVA_HOME=/opt/homebrew/opt/openjdk@21`; without it the
run fails before the flow starts (verified 2026-10-08,
`.maestro/onboarding-fresh-install.yaml`, 17/17 steps).

## Load rule

Run `make verify` / `check:all` / full jest only when the 5-minute load
average (`sysctl -n vm.loadavg`) is below 10: wait first with
`bash scripts/wait-load.sh 10` (run it in the background and wait on its
exit code: 0 once the load is below 10, 2 when its 3600 s timeout, an
optional second argument, passes first, 3 when it cannot read the load,
64 for a bad argument; it prints one start line and nothing else).
Every load or "is verify still running" wait goes ONLY through
`bash scripts/wait-load.sh <max>` (background, exit code; main checkout path
when the worktree lacks it). Never write a loop that greps ps/pgrep output for
make verify, check:all, jest or stryker: the loop's own command line contains
the pattern and it matches itself. kill-guard denies this loop shape before it
runs (kiko-linter "WAIT-LOOP deny"); a `ps -p <pid>` or `kill -0 <pid>` wait
stays allowed. At most ONE jest-heavy agent per track; Semgrep or jest
timeouts at high load are environment, not code: re-run at low load,
never raise a timeout. See memory `check-security-timeout-under-load`.

Background Claude sessions export FORCE_COLOR=3; run checks as `env -u FORCE_COLOR <command>`.
