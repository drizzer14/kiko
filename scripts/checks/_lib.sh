#!/usr/bin/env bash
# Shared helper for harness check wrappers. Prints the structured failure
# block to stderr so a Claude Code hook (exit 2) feeds it back to the agent.

print_block() {
  # $1 name  $2 what  $3 details  $4 why  $5 howto  $6 donot
  {
    printf '────────────────────────────────────────────────────────\n'
    printf '✖ CHECK FAILED: %s\n' "$1"
    printf '────────────────────────────────────────────────────────\n'
    printf 'WHAT FAILED:    %s\n' "$2"
    printf 'DETAILS:        %s\n' "$3"
    printf 'WHY IT MATTERS: %s\n' "$4"
    printf 'HOW TO FIX:     %s\n' "$5"
    printf 'DO NOT:         %s\n' "$6"
    printf '────────────────────────────────────────────────────────\n'
  } >&2
}

# --- Content dedup + single-flight for the check wrappers --------------------
# A check must not run when nothing it depends on changed. Each wrapper
# computes a fingerprint of its own real inputs (the target files plus its
# config and tool version), records that fingerprint when the check passes,
# and skips the next run whose fingerprint is identical. This removes the
# duplicate runs that happen across agents and sessions: the Stop and the
# SubagentStop hooks both call the medium tier, and a developer agent re-ran
# check:deep after only an icon asset was added.
#
# A skip is only ever recorded on a PASS, so a failing check always re-runs
# until it is fixed. The state lives outside the repo (per worktree, keyed
# by the worktree path) so it never trips a filesystem scanner and needs no
# .gitignore entry. The macOS system bash is 3.2, so these use only portable
# constructs (no mapfile, no flock).

# harness_state_dir <root> : the per-worktree state directory path.
harness_state_dir() {
  local key
  key="$(printf '%s' "$1" | shasum 2>/dev/null | cut -c1-16)"
  printf '%s/kiko-harness/%s' "${TMPDIR:-/tmp}" "$key"
}

# harness_hash : read stdin, print a short stable hash. Wrappers pipe their
# fingerprint inputs (file hashes, config hashes, a tool version) into this.
harness_hash() {
  shasum 2>/dev/null | cut -c1-40
}

# harness_passfp_file <root> <key> : path to the stored last-pass fingerprint
# for a check identified by <key> (for example "knip" or "lint:<path hash>").
harness_passfp_file() {
  local state safe
  state="$(harness_state_dir "$1")"
  mkdir -p "$state" 2>/dev/null || true
  safe="$(printf '%s' "$2" | shasum 2>/dev/null | cut -c1-16)"
  printf '%s/pass.%s.fp' "$state" "$safe"
}

# harness_unchanged <root> <key> <fingerprint> : return 0 when <fingerprint>
# equals the fingerprint stored for <key> the last time the check passed. An
# empty fingerprint never matches, so a check that cannot fingerprint its
# inputs always runs.
harness_unchanged() {
  local file
  [ -n "$3" ] || return 1
  file="$(harness_passfp_file "$1" "$2")"
  [ -f "$file" ] && [ "$3" = "$(cat "$file" 2>/dev/null)" ]
}

# harness_mark_pass <root> <key> <fingerprint> : record <fingerprint> as the
# state that passed <key>, so an identical next run skips.
harness_mark_pass() {
  local file
  [ -n "$3" ] || return 0
  file="$(harness_passfp_file "$1" "$2")"
  printf '%s' "$3" > "$file" 2>/dev/null || true
}

# harness_lock <lockdir> [max_wait_seconds] : acquire a single-flight lock
# with mkdir (atomic). Reclaims a lock whose holder process is gone.
# Returns 0 on acquire, 1 on timeout so the caller proceeds unlocked
# rather than hang the hook.
harness_lock() {
  local lock="$1" max="${2:-240}" waited=0 pid
  while ! mkdir "$lock" 2>/dev/null; do
    pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$lock" 2>/dev/null || true
      continue
    fi
    if [ "$waited" -ge "$max" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  printf '%s' "$$" > "$lock/pid" 2>/dev/null || true
  return 0
}

# harness_unlock <lockdir> : release a lock this process holds.
harness_unlock() {
  rm -rf "$1" 2>/dev/null || true
}

# harness_global_lock_dir : the machine-wide (per-user) single-flight lock
# path for mutation runs. It is a FIXED path, NOT keyed by the worktree, so
# only ONE Stryker can run at a time across ALL worktrees. TMPDIR is stable
# per user, so every worktree resolves the same path; the tests override
# TMPDIR to isolate. This is deliberately not the per-worktree state dir
# (harness_state_dir), which the content-dedup fingerprints still use.
harness_global_lock_dir() {
  printf '%s/kiko-harness/mutation.global.lock' "${TMPDIR:-/tmp}"
}

# harness_try_lock <lockdir> [holder_info] : fail-fast single-flight acquire
# via mkdir (atomic). Unlike harness_lock it NEVER waits: it returns 1
# immediately when a LIVE holder holds the lock, so the caller can fail fast
# instead of queueing. A lock whose recorded holder process is gone is
# reclaimed once, then acquired. On acquire it records this process's pid and
# the holder_info (for example the worktree path) inside the lock dir, so a
# refusal message can name who holds it. Returns 0 on acquire, 1 on refusal.
harness_try_lock() {
  local lock="$1" info="${2:-}" pid
  if mkdir "$lock" 2>/dev/null; then
    printf '%s' "$$" > "$lock/pid" 2>/dev/null || true
    printf '%s' "$info" > "$lock/holder" 2>/dev/null || true
    return 0
  fi
  # The lock exists. Reclaim it only if the recorded holder process is gone.
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    rm -rf "$lock" 2>/dev/null || true
    if mkdir "$lock" 2>/dev/null; then
      printf '%s' "$$" > "$lock/pid" 2>/dev/null || true
      printf '%s' "$info" > "$lock/holder" 2>/dev/null || true
      return 0
    fi
  fi
  return 1
}

# harness_lock_holder <lockdir> : print a short description of the current
# lock holder ("pid <n> (worktree <path>)") for a refusal message.
harness_lock_holder() {
  local lock="$1" pid info
  pid="$(cat "$lock/pid" 2>/dev/null || printf 'unknown')"
  info="$(cat "$lock/holder" 2>/dev/null || true)"
  if [ -n "$info" ]; then
    printf 'pid %s (worktree %s)' "$pid" "$info"
  else
    printf 'pid %s' "$pid"
  fi
}

# --- Mutation progress log + Jenkins-style ETA history -----------------------
# check:deep's mutation step (scripts/checks/mutation.sh) is manual, not
# hook-wired, and takes minutes. These helpers give a HUMAN a live, tailable
# progress log and a Jenkins-style ETA computed from past runs, so nobody has to
# poll the run — its exit code is still the only signal an agent waits on. All of
# this is best-effort and MUST NOT change the gate's pass/fail: every write is
# guarded, and a missing/corrupt history just means "no estimate". State lives in
# a `mutation/` subdir of the per-worktree out-of-repo state dir (harness_state_dir),
# keyed like the content-dedup fingerprints, so it never trips a filesystem scanner.

# harness_mutation_progress_log <root> : the stable, tailable log file Stryker's
# combined output is tee'd to. mkdir -p its dir so a `tail -f` works immediately.
harness_mutation_progress_log() {
  local state
  state="$(harness_state_dir "$1")"
  mkdir -p "$state/mutation" 2>/dev/null || true
  printf '%s/mutation/progress.log' "$state"
}

# harness_mutation_history_file <root> : the append-only TSV of COMPLETED runs,
# one record per line: iso-timestamp<TAB>durationSeconds<TAB>mutantCount<TAB>score.
# mutantCount/score are best-effort and may be empty.
harness_mutation_history_file() {
  local state
  state="$(harness_state_dir "$1")"
  mkdir -p "$state/mutation" 2>/dev/null || true
  printf '%s/mutation/history.tsv' "$state"
}

# harness_mutation_history_append <root> <iso> <duration> <count> <score> :
# append one completed-run record. Guarded — a write failure never aborts.
harness_mutation_history_append() {
  local file
  file="$(harness_mutation_history_file "$1")"
  printf '%s\t%s\t%s\t%s\n' "$2" "$3" "$4" "$5" >> "$file" 2>/dev/null || true
}

# harness_fmt_duration <seconds> : pure formatter. "45s", "1m", "1m 30s". A
# missing or non-numeric argument is treated as zero, never a crash.
harness_fmt_duration() {
  local s="${1:-0}" m
  case "$s" in '' | *[!0-9]*) s=0 ;; esac
  if [ "$s" -lt 60 ]; then
    printf '%ds' "$s"
  else
    m=$((s / 60))
    s=$((s % 60))
    if [ "$s" -eq 0 ]; then printf '%dm' "$m"; else printf '%dm %ds' "$m" "$s"; fi
  fi
}

# harness_mutation_history_stats <historyfile> : pure. Print one TSV line
# "avgSeconds<TAB>lastDuration<TAB>lastCount<TAB>lastDate" computed from the valid
# records (a record is valid only when its duration field is a positive integer),
# or NOTHING when there are no valid records (missing/empty/corrupt file). The
# average is over the last up-to-3 runs (Jenkins-style); the last run's own
# fields feed the parenthetical detail. Portable awk (bash 3.2, no jq).
harness_mutation_history_stats() {
  [ -f "$1" ] || return 0
  awk -F'\t' '
    # A record is valid only when its duration is a strictly-positive integer.
    # A 0s duration (a mid-run backward clock jump) is filtered so it can never
    # drag the rolling average toward zero — the wrapper also refuses to append
    # one, this is defense-in-depth for a pre-existing/hand-edited history file.
    $2 ~ /^[0-9]+$/ && $2 + 0 > 0 {
      v++; dur[v]=$2; cnt[v]=$3;
      d=$1; sub(/T.*/, "", d); dt[v]=d;
    }
    END {
      if (v == 0) exit 0;
      start = v - 2; if (start < 1) start = 1;
      sum = 0; k = 0;
      for (i = start; i <= v; i++) { sum += dur[i]; k++ }
      avg = int(sum / k + 0.5);
      printf "%d\t%d\t%s\t%s\n", avg, dur[v], cnt[v], dt[v];
    }
  ' "$1" 2>/dev/null || true
}

# harness_mutation_estimate_line <historyfile> : print the human ETA line for a
# run that is ABOUT to start. With history: an "Estimated ~<avg> (last run: ...)"
# line; without any valid history: the plain no-estimate line. Never crashes.
harness_mutation_estimate_line() {
  local stats avg lastdur lastcnt lastdate
  stats="$(harness_mutation_history_stats "$1")"
  if [ -z "$stats" ]; then
    printf 'No mutation history yet — no estimate available.\n'
    return 0
  fi
  avg="$(printf '%s' "$stats" | cut -f1)"
  lastdur="$(printf '%s' "$stats" | cut -f2)"
  lastcnt="$(printf '%s' "$stats" | cut -f3)"
  lastdate="$(printf '%s' "$stats" | cut -f4)"
  if [ -n "$lastcnt" ]; then
    printf 'Estimated ~%s (last run: %s over %s mutants on %s)\n' \
      "$(harness_fmt_duration "$avg")" "$(harness_fmt_duration "$lastdur")" "$lastcnt" "$lastdate"
  else
    printf 'Estimated ~%s (last run: %s on %s)\n' \
      "$(harness_fmt_duration "$avg")" "$(harness_fmt_duration "$lastdur")" "$lastdate"
  fi
}

# harness_code_fingerprint <root> : a hash of only the inputs that change a
# code check's result — the .ts/.tsx/.js source state relative to HEAD plus
# the manifest and config files. A change that touches none of these (an
# icon asset, an ios/ file, a doc) leaves the fingerprint unchanged, so the
# project-wide checks (knip, deps, mutation) skip a re-run that would
# produce the identical result. This is scoped, not whole-tree, on purpose:
# Stryker mutates only .ts/.tsx and runs Jest over .ts/.tsx tests, knip and
# depcheck read only source plus their configs and the manifests.
#
# Speed matters: a skip must be far cheaper than the check. So this hashes
# HEAD plus one `git diff` of the source (tracked modifications) plus the
# few untracked source files, never a per-file hash of the whole tree.
harness_code_fingerprint() {
  local root="$1" c u
  {
    git -C "$root" rev-parse HEAD 2>/dev/null
    git -C "$root" diff HEAD -- '*.ts' '*.tsx' '*.js' 2>/dev/null
    git -C "$root" ls-files --others --exclude-standard -- '*.ts' '*.tsx' '*.js' 2>/dev/null \
      | grep -vE '^(ios/|node_modules/)' \
      | while IFS= read -r u; do
          printf '%s\n' "$u"
          shasum "$root/$u" 2>/dev/null
        done
    for c in package.json package-lock.json biome.json knip.json \
             .depcheckrc.json .jscpd.json tsconfig.json jest.config.js \
             babel.config.js stryker.conf.json; do
      [ -f "$root/$c" ] && shasum "$root/$c" 2>/dev/null
    done
  } | shasum 2>/dev/null | cut -c1-40
}
