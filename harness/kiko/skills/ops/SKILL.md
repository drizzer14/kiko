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
  command's return yourself. This covers `check:deep`, `check:mutation`,
  `osv.sh`, `check:all`, `check:knip`, `check:deps`, `check:typecheck`,
  and any long build / `pod install` / device deploy. These emit no
  useful incremental output, so polling them burns tokens for zero
  signal.
- **Mutation testing runs per SMALL change set only — never on a whole
  project or a whole release.** There is no whole-release deep gate. Set
  `KIKO_MUTATION_BASE` to the change set's own base commit so only its
  files are mutated. `scripts/checks/mutation.sh` exits 2 before Stryker
  starts when more than 30 files would be mutated (`MUTATION_FILE_CAP`);
  `KIKO_MUTATION_FULL=1` and a `KIKO_MUTATION_BASE` that does not
  resolve are refused directly (exit 2), and no env var bypasses the cap
  (on next; arrives on main with release 1.1).
  On that failure, split the run into smaller change sets — never raise
  the cap.
- Always run a mutation run through the wrapper (`make deep` /
  `npm run check:deep` / `npm run check:mutation`); it is single-flighted
  and tears its own workers down. Never run `npx stryker run` directly —
  an orphaned Stryker spawns one worker per core and can overload the
  machine.
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
- **`make deep` / `check:deep` is the COORDINATOR's own job, not an ops
  dispatch.** The coordinator runs the long, no-incremental checks
  (Stryker mutation + osv) ITSELF as a background process and launches
  the human `tail -F` of the progress log at the same time
  (`scripts/checks/mutation.sh` prints the exact tail command near the
  start). NEVER dispatch a `kiko:ops` subagent to "run `make deep` and
  wait": a watching subagent only polls the run, burns tokens, and
  cannot be stopped mid-flight.
- **Track the known CVEs with `bash scripts/checks/osv.sh` on its own.**
  `check:deep` can stop at the mutation cap before it reaches osv, so
  its exit code does not prove the osv result.
- **`devicectl` "unavailable" or CoreDevice error 4016 means ask the
  user to connect USB and unlock the phone** — do not rebuild. The
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
   installing. This is the only proof that the bundle regenerated. Pick
   an ASCII string: Hermes stores a non-ASCII string (Cyrillic, ₴, …) as
   UTF-16LE, so a plain grep misses it and reads a fresh bundle as
   stale. For a non-ASCII string use
   `python3 -c "import sys; print('<str>'.encode('utf-16-le') in open(sys.argv[1],'rb').read())" <bundle>`.
3. Install with `devicectl`, not `xcodebuild ... install -destination
   generic/platform=iOS` — the latter reports SUCCEEDED without
   reaching the physical device.
4. Verify the install actually replaced the app: the new
   `installationURL` container UUID must differ from the prior install.
5. Launch with `devicectl device process launch`.
6. Use an external `-derivedDataPath`, never an in-worktree `build/` or
   `ios/DerivedData` — those trip the repo's gitleaks secrets scan (see
   root `CLAUDE.md`'s "Documented exceptions").

Always pass the physical iPhone UDID explicitly (`deploy-device.sh
<udid>` or `DEVICE_ID`). Never pick "the connected device" — a booted
simulator also shows as connected. Build with the configuration
`deploy-device.sh` uses. After install, compare the app data container
UUID with the prior install before you report success.

A change under `harness/kiko/` (hooks, scripts it calls) is live only
after a plugin update — see `harness-workflow`'s "Harness hook changes
go live only after a plugin update". Verify with a harmless probe
before you rely on a hook.

## Device-test checkout

Build device-test installs from the dedicated detached checkout
`~/orca/workspaces/pff-ios/device-deploy` (move its HEAD with `git
checkout --detach <sha>`; it keeps `node_modules`, Pods, and the build
cache — never prune it), never from a worktree with work in progress.
Installing over a database created by a NEWER branch is a downgrade:
do a clean reinstall instead. After the checkout path changes, the
first build is clean (`rm ios/build`, `pod install`).

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
