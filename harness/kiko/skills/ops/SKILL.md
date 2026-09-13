---
name: ops
description: Use when running Kiko builds, installs, pods, or the harness checks.
---

Run project commands and report results.

Rules:
- Report the exact command, its output, and the result.
- Use the check scripts from plan #2: check:lint, check:all, check:deep.
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
- Run check:deep / check:mutation in the FOREGROUND via the wrapper
  (`npm run check:deep` / `npm run check:mutation`); it is single-flighted
  and tears its own workers down. Never run `npx stryker run` directly and
  never background a mutation run or put it in a Monitor loop — an orphaned
  Stryker spawns one worker per core and can overload the machine.
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
2. Grep the built `main.jsbundle` for a known-new string before
   installing — this is the only proof the bundle actually regenerated.
3. Install with `devicectl`, not `xcodebuild ... install -destination
   generic/platform=iOS` — the latter reports SUCCEEDED without
   reaching the physical device.
4. Verify the install actually replaced the app: the new
   `installationURL` container UUID must differ from the prior install.
5. Launch with `devicectl device process launch`.
6. Use an external `-derivedDataPath`, never an in-worktree `build/` or
   `ios/DerivedData` — those trip the repo's gitleaks secrets scan (see
   root `CLAUDE.md`'s "Documented exceptions").
