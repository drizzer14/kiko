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

# --- Mutation progress log + per-mutant-rate ETA history ---------------------
# check:deep's mutation step (scripts/checks/mutation.sh) is manual, not
# hook-wired, and takes minutes. These helpers give a HUMAN a live, tailable
# progress log and an ETA derived from past runs, so nobody has to poll the run
# — its exit code is still the only signal an agent waits on. The ETA is based on
# a PER-MUTANT RATE (seconds per mutant) computed from history, times the CURRENT
# run's actual mutant count once Stryker reports it. A flat average of whole-run
# DURATIONS would be meaningless: diff-scoped runs vary from a few dozen mutants
# to thousands, so normalizing by mutant count is what makes the estimate mean
# anything. All of this is best-effort and MUST NOT change the gate's pass/fail:
# every write is guarded, and a missing/corrupt history just means "no estimate".
# State lives in a `mutation/` subdir of the per-worktree out-of-repo state dir
# (harness_state_dir), keyed like the content-dedup fingerprints, so it never
# trips a filesystem scanner.

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

# harness_mutation_rate <historyfile> : pure. Print the MEDIAN per-mutant rate
# (seconds per mutant) over the last up-to-5 VALID records, or NOTHING when there
# are no valid records (missing/empty/corrupt/count-less history). A record is
# valid only when BOTH its duration ($2) and its mutant count ($3) are
# strictly-positive integers — so old count-less records (no rate is computable)
# and 0-duration clock-skew records are excluded, and a rate can never divide by
# an empty or zero count. Each valid record's rate is duration/count; normalizing
# by mutant count is the whole point (a 5574-mutant run and a 40-mutant run give
# comparable per-mutant rates, not wildly different whole-run durations). The
# median is printed with printf "%g" so 2.0 prints "2" and 1.2 prints "1.2".
# Portable awk only (bash 3.2: no mapfile, no jq); the median is a tiny insertion
# sort over the <=5 collected rates, averaging the two middle values on an even
# count.
harness_mutation_rate() {
  [ -f "$1" ] || return 0
  awk -F'\t' '
    $2 ~ /^[0-9]+$/ && $2 + 0 > 0 && $3 ~ /^[0-9]+$/ && $3 + 0 > 0 {
      v++; rate[v] = $2 / $3;
    }
    END {
      if (v == 0) exit 0;
      # Keep only the last up-to-5 valid records (most recent).
      start = v - 4; if (start < 1) start = 1;
      n = 0;
      for (i = start; i <= v; i++) { n++; r[n] = rate[i]; }
      # Insertion sort r[1..n] ascending.
      for (i = 2; i <= n; i++) {
        key = r[i]; j = i - 1;
        while (j >= 1 && r[j] > key) { r[j + 1] = r[j]; j--; }
        r[j + 1] = key;
      }
      if (n % 2 == 1) {
        med = r[(n + 1) / 2];
      } else {
        med = (r[n / 2] + r[n / 2 + 1]) / 2;
      }
      printf "%g", med;
    }
  ' "$1" 2>/dev/null || true
}

# harness_mutation_eta_filter <rate> : a pipe STAGE for the mutation run. It reads
# Stryker's combined output line by line and PASSES EVERY LINE THROUGH unchanged
# (fflush after each so streaming stays live). On the FIRST line matching an
# "N/M" counter it parses M (the run's mutant count = the denominator) and, if
# <rate> is a positive number and M>0, prints exactly ONE extra line:
#   Estimated ~<fmt> for <M> mutants (~<rate>s/mutant from history)
# where <fmt> is rate*M rounded to whole seconds. When <rate> is empty or
# non-positive it prints no ETA line and only passes lines through. This is a
# downstream stage: it NEVER changes the exit code — the wrapper reads
# PIPESTATUS[0] (Stryker), which adding a stage does not affect.
harness_mutation_eta_filter() {
  local rate="${1:-}"
  awk -v rate="$rate" '
    # fmtdur mirrors harness_fmt_duration in this same file: <60 -> "Ns";
    # a whole minute -> "Nm"; else "Nm Ss".
    function fmtdur(s,   m) {
      s = int(s + 0.5);
      if (s < 60) return s "s";
      m = int(s / 60); s = s % 60;
      if (s == 0) return m "m";
      return m "m " s "s";
    }
    {
      print; fflush();
      if (!done && rate + 0 > 0 && $0 ~ /[0-9]+\/[0-9]+/) {
        if (match($0, /[0-9]+\/[0-9]+/)) {
          split(substr($0, RSTART, RLENGTH), a, "/");
          m = a[2] + 0;
          if (m > 0) {
            printf "Estimated ~%s for %d mutants (~%gs/mutant from history)\n", \
              fmtdur(rate * m), m, rate + 0;
            fflush();
            done = 1;
          }
        }
      }
    }
  '
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
