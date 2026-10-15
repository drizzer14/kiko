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

# harness_require_path <check> <path> : succeed when <path> exists. Otherwise print the failure
# block for <check> and return 1; the caller exits 2. A scan of a path that is not on disk finds
# nothing, and a check that finds nothing passes, so a missing scan root or a deleted file would
# read as a clean tree.
harness_require_path() {
  [ -e "$2" ] && return 0
  print_block \
    "$1" \
    "A path given to this check does not exist, so nothing was scanned." \
    "Missing path: $2" \
    "A check cannot read a path that is not on disk, and scanning nothing would report a clean tree. A missing file is not a pass." \
    "Fix the path, or drop it from the arguments when the file was deleted. Then re-run the check." \
    "Do not create an empty file or directory at the path to get past this."
  return 1
}

# harness_require_file <check> <path> : like harness_require_path, and <path> must also be a
# regular file. A per-file wrapper handed a directory would otherwise scan nothing and pass.
harness_require_file() {
  harness_require_path "$1" "$2" || return 1
  [ -f "$2" ] && return 0
  print_block \
    "$1" \
    "This check takes a file, not a directory or another kind of path." \
    "Not a file: $2" \
    "A per-file check cannot scan a directory, and scanning nothing would report a clean tree." \
    "Pass one file, or run the project-wide form of the check (no argument) to scan a tree." \
    "Do not pass a directory and read the silence as a pass."
  return 1
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

# harness_replay_mark <root> : the HEAD sha, or nothing for an unborn HEAD.
# guard-replay.sh reads it when a run starts and, on a pass, moves this
# worktree's mark ref (harness_replay_ref) to it — never back to the mark's
# own ancestor (see record_mark there); the replay then skips every commit
# any worktree's mark ref reaches. medium.sh compares it with this worktree's
# mark ref to tell whether HEAD moved since the last pass, so a turn that
# only committed still runs the replay.
harness_replay_mark() {
  git -C "$1" rev-parse -q --verify HEAD 2>/dev/null
}

# harness_replay_ref <root> : this worktree's guard-replay mark ref,
# refs/kiko/guard-replay/<id>, where <id> is the first 16 hex digits of the
# SHA-1 of the worktree's absolute git dir (<repo>/.git for the main
# checkout, <repo>/.git/worktrees/<name> for a linked one). That dir stays
# the same across a branch switch and a `git worktree move`, no two live
# worktrees share it, and the hash is ref-safe whatever the worktree is
# called. Refs live in the shared repository, so every worktree sees every
# worktree's mark, and a purge of TMPDIR loses none.
harness_replay_ref() {
  local gitDirectory
  gitDirectory="$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  printf 'refs/kiko/guard-replay/%s' "$(printf '%s' "$gitDirectory" | shasum 2>/dev/null | cut -c1-16)"
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
# State lives in a `mutation/` subdir of an out-of-repo state dir
# (harness_state_dir), keyed like the content-dedup fingerprints, so it never
# trips a filesystem scanner. The progress log is per worktree; the two history
# files are shared by every worktree of one repository (see
# harness_mutation_history_dir).
#
# A timed-out mutant costs far more than a normal one (the run waits out its
# timeout and restarts the test runner), and one slow-test file can time out
# most of its mutants, so a single per-mutant rate misses by hours. The history
# therefore also records, per run and per file, how many mutants timed out; the
# estimate splits the remaining mutants into normal and timed-out ones.

# harness_mutation_progress_log <root> : the stable, tailable log file Stryker's
# combined output is tee'd to. mkdir -p its dir so a `tail -f` works immediately.
harness_mutation_progress_log() {
  local state
  state="$(harness_state_dir "$1")"
  mkdir -p "$state/mutation" 2>/dev/null || true
  printf '%s/mutation/progress.log' "$state"
}

# harness_mutation_history_dir <root> : the directory of the run history and the
# per-file history. It is keyed by the git COMMON dir, not by <root>: a gate runs
# in a per-change-set worktree, so a per-worktree key would never see an earlier
# run of the same file, and the common dir is the one path every worktree of the
# repository shares. A root git cannot answer for (no repository, or a git older
# than --path-format) is keyed by itself.
harness_mutation_history_dir() {
  local common state
  common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || common=""
  case "$common" in /*) ;; *) common="$1" ;; esac
  state="$(harness_state_dir "$common")"
  mkdir -p "$state/mutation" 2>/dev/null || true
  printf '%s/mutation' "$state"
}

# harness_mutation_history_file <root> : the append-only TSV of COMPLETED runs, one
# record per line: iso-timestamp<TAB>durationSeconds<TAB>mutantCount<TAB>score<TAB>
# tested<TAB>timedOut. tested and timedOut come from Stryker's last progress line (how
# many mutants ran and how many of those timed out). All but the first two fields are
# best-effort and may be empty.
harness_mutation_history_file() {
  printf '%s/history.tsv' "$(harness_mutation_history_dir "$1")"
}

# harness_mutation_files_file <root> : the append-only per-file TSV, one record per
# graded file per completed run: iso-timestamp<TAB>path<TAB>tested<TAB>timedOut. The
# counts cover only the mutants inside that run's changed lines.
harness_mutation_files_file() {
  printf '%s/files.tsv' "$(harness_mutation_history_dir "$1")"
}

# harness_mutation_history_append <root> <iso> <duration> <count> <score> [tested]
# [timedOut] : append one completed-run record of six fields. Guarded — a write
# failure never aborts. The stderr redirect comes first so a failing `>>` (a
# directory in the way) stays silent too.
harness_mutation_history_append() {
  local file
  file="$(harness_mutation_history_file "$1")"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$2" "$3" "$4" "$5" "${6:-}" "${7:-}" 2>/dev/null >> "$file" || true
}

# harness_mutation_files_append <root> <iso> : read the change-set scorer's output on
# stdin and append one files.tsv record per graded file. The scorer prints one row per
# file, `<path>: <score> killed=K timeout=X survived=S noCoverage=N`; tested is
# K + X + S (a noCoverage mutant never ran, so it never timed out). Any other line
# (the total, the gate line, an excluded or ungraded file) is skipped. Guarded.
harness_mutation_files_append() {
  local file
  file="$(harness_mutation_files_file "$1")"
  awk -v iso="$2" '
    /^CHANGE SET TOTAL: / { next }
    {
      if (!match($0, / killed=[0-9]+ timeout=[0-9]+ survived=[0-9]+ noCoverage=[0-9]+$/)) next;
      head = substr($0, 1, RSTART - 1);
      split(substr($0, RSTART + 1), counts, /[= ]/);
      if (!sub(/: [0-9]+(\.[0-9]+)?$/, "", head)) next;
      tested = counts[2] + counts[4] + counts[6];
      if (tested > 0) printf "%s\t%s\t%d\t%d\n", iso, head, tested, counts[4];
    }
  ' 2>/dev/null >> "$file" || true
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
# by mutant count keeps a big run and a small one on one scale, but only roughly:
# every run also pays a fixed startup cost (the initial test run), so a small run
# has a higher rate than a big one. A changed-line run has few mutants, so the
# first changed-line ETAs read short while the history still holds whole-file
# rates; after a few changed-line runs the median fits them. The count is the
# denominator of Stryker's "N/M tested", which counts only the mutants that run.
# The ETA is shown to a human only and never changes the gate's result. The
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

# harness_mutation_run_counts : read Stryker's output on stdin and print
# "<mutants> <tested> <timedOut>" from the LAST progress counter, a line holding
# `N/M tested` (Stryker's append-only reporter prints one every 10 s:
# `... 1117/1130 tested (56 survived, 435 timed out)`). M counts the mutants that run, N
# how many have run so far. timedOut stays empty for a counter without the clause,
# and nothing is printed without a counter. Only a counter that says `tested` counts:
# a test title such as `rules 1/2/3` in the clear-text survivor list is not one.
harness_mutation_run_counts() {
  awk '
    match($0, /[0-9]+\/[0-9]+ tested/) {
      split(substr($0, RSTART, RLENGTH), counter, "/");
      tested = counter[1] + 0;
      mutants = counter[2] + 0;
      timed = "";
      if (match($0, /[0-9]+ timed out\)/)) timed = substr($0, RSTART, RLENGTH) + 0;
      seen = 1;
    }
    END { if (seen) printf "%d %d %s", mutants, tested, timed }
  ' 2>/dev/null || true
}

# harness_mutation_costs <historyfile> : pure. Print "<normal> <timedOut>", the fitted
# seconds one normal mutant and one timed-out mutant cost, or NOTHING when no sound fit
# exists (the caller then falls back to the median rate plus the configured floor).
# Each qualifying history record (positive integer duration D and mutant count M, and
# tested/timedOut fields that are integers with 0 < tested and timedOut <= tested) says
# D = a*K + b*X, with X = M * timedOut / tested the timed-out mutants of the run, K = M - X
# the others, a the normal cost and b the timed-out cost. A least-squares fit through
# the origin over the last up-to-10 qualifying records solves the two normal equations.
# It prints nothing for fewer than 2 records, for records whose timeout shares are too close
# to separate the two costs, and when either cost comes out non-positive. "Too close" is
# determinant <= 0.1 * sum(K^2)*sum(X^2), where determinant / (sum(K^2)*sum(X^2)) is sin^2 of
# the angle between the K and X columns: 0 for one share (the system is singular, which also
# covers a history with no timeout and one where every mutant timed out) and 1 for columns at
# right angles. Measured on true costs 2 s and 40 s with a worst-case 4% error in two
# durations: at 0.01 (a 5 point spread) the fitted ETA is off by up to 58% inside 20..80%
# timeouts, at 0.1 (12 to 16 points) by 13..17% (3..4% at 1% error), and 40% against 42%
# (0.0017) reads 16.8 s and 17.9 s, a timeout as cheap as a normal mutant. Below the bound the
# caller takes the fallback, which is exact at the history own share. The fitted normal cost
# includes the fixed startup of a run, because the history gives no way to separate it.
harness_mutation_costs() {
  [ -f "$1" ] || return 0
  awk -F'\t' '
    $2 ~ /^[0-9]+$/ && $2 + 0 > 0 && $3 ~ /^[0-9]+$/ && $3 + 0 > 0 &&
    $5 ~ /^[0-9]+$/ && $5 + 0 > 0 && $6 ~ /^[0-9]+$/ && $6 + 0 <= $5 + 0 {
      n++;
      slow[n] = $3 * $6 / $5;
      normal[n] = $3 - slow[n];
      duration[n] = $2 + 0;
    }
    END {
      if (n < 2) exit 0;
      start = n - 9; if (start < 1) start = 1;
      for (i = start; i <= n; i++) {
        normalSquares += normal[i] * normal[i];
        slowSquares += slow[i] * slow[i];
        cross += normal[i] * slow[i];
        normalDuration += normal[i] * duration[i];
        slowDuration += slow[i] * duration[i];
      }
      product = normalSquares * slowSquares;
      determinant = product - cross * cross;
      if (determinant <= 0.1 * product) exit 0;
      normalCost = (normalDuration * slowSquares - slowDuration * cross) / determinant;
      slowCost = (slowDuration * normalSquares - normalDuration * cross) / determinant;
      if (normalCost > 0 && slowCost > 0) printf "%g %g", normalCost, slowCost;
    }
  ' "$1" 2>/dev/null || true
}

# harness_mutation_run_share <historyfile> : pure. Print the percent of mutants that timed
# out in the last up-to-5 history records that carry the tested and timed-out fields (the
# records harness_mutation_rate draws on, bar old ones lacking the fields), or NOTHING when no
# record does. It is the timeout share the history rate already contains, which the eta filter
# takes out of the normal cost.
harness_mutation_run_share() {
  [ -f "$1" ] || return 0
  awk -F'\t' '
    $5 ~ /^[0-9]+$/ && $5 + 0 > 0 && $6 ~ /^[0-9]+$/ && $6 + 0 <= $5 + 0 {
      runs++; tested[runs] = $5 + 0; timed[runs] = $6 + 0;
    }
    END {
      start = runs - 4; if (start < 1) start = 1;
      for (i = start; i <= runs; i++) { sumTested += tested[i]; sumTimed += timed[i] }
      if (sumTested > 0) printf "%g", 100 * sumTimed / sumTested;
    }
  ' "$1" 2>/dev/null || true
}

# harness_mutation_timeout_share <filesfile> <historyfile> : read `path<TAB>changedLines` on
# stdin (one row per file about to be mutated; a whole file counts its line count) and
# print "<percent> <F> <N>": the share of mutants expected to time out over the N files,
# one decimal, and how many of them (F) contributed to it. A file's share is the sum of
# timedOut over the sum of tested in its last 3 files.tsv records; a file with no
# record takes the run-level share (the same sum over the last 5 history.tsv records
# that carry the two fields); with neither, it is left out. The percent weights each
# file's share by its changed lines, the only per-file size known before the run. Nothing
# is printed when no file has a share, so the caller shows "none".
harness_mutation_timeout_share() {
  awk -v files="$1" -v history="$2" '
    function valid(tested, timed) {
      return tested ~ /^[0-9]+$/ && tested + 0 > 0 && timed ~ /^[0-9]+$/ && timed + 0 <= tested + 0;
    }
    BEGIN {
      FS = "\t";
      if (history != "") {
        while ((getline line < history) > 0) {
          split(line, field, "\t");
          if (valid(field[5], field[6])) { runs++; runTested[runs] = field[5] + 0; runTimed[runs] = field[6] + 0 }
        }
        close(history);
      }
      start = runs - 4; if (start < 1) start = 1;
      for (i = start; i <= runs; i++) { sumTested += runTested[i]; sumTimed += runTimed[i] }
      if (sumTested > 0) { runShare = sumTimed / sumTested; haveRunShare = 1 }
      if (files != "") {
        while ((getline line < files) > 0) {
          split(line, field, "\t");
          if (valid(field[3], field[4])) {
            records[field[2]]++;
            fileTested[field[2], records[field[2]]] = field[3] + 0;
            fileTimed[field[2], records[field[2]]] = field[4] + 0;
          }
        }
        close(files);
      }
    }
    $2 ~ /^[0-9]+$/ && $2 + 0 > 0 {
      total++;
      count = records[$1] + 0;
      if (count > 0) {
        first = count - 2; if (first < 1) first = 1;
        testedSum = 0; timedSum = 0;
        for (i = first; i <= count; i++) { testedSum += fileTested[$1, i]; timedSum += fileTimed[$1, i] }
        share = timedSum / testedSum;
      } else if (haveRunShare) {
        share = runShare;
      } else {
        next;
      }
      known++;
      weighted += $2 * share;
      weights += $2;
    }
    END { if (known > 0) printf "%.1f %d %d", 100 * weighted / weights, known, total }
  ' 2>/dev/null || true
}

# harness_mutation_eta_filter <rate> [normal] [timedOut] [share] [timeoutMS] [concurrency]
# [historyShare] : a pipe STAGE for the mutation run. It reads Stryker's combined output line by
# line and PASSES EVERY LINE THROUGH unchanged (fflush after each so streaming stays live). It
# only ever adds lines after the one it read. It does the following:
# - On the FIRST `N/M tested` counter it parses M (the run's mutant count = the
#   denominator) and, if <rate> is a positive number and M>0, prints ONE line.
#   Without a split it reads
#     Estimated ~<fmt> for <M> mutants (~<rate>s/mutant from history)
#   where <fmt> is rate*M rounded to whole seconds. With a split (<share> a percent in
#   0..100, and a timed-out cost known) it reads
#     Estimated ~<fmt> for <M> mutants (~<a>s/mutant, <P>% timeouts at ~<b>s each, from history)
#   where <fmt> is M * ((1 - p) * a + p * b) and p is <share> / 100.
# - At each 10% boundary of N/M after that (the first at 10%, and only once N >= 20
#   and the counter carries the timeout clause), it prints ONE update:
#     Estimate at <10k>%: ~<fmt> remaining (<Q>% timeouts so far)
#   with q = timedOut / N from the counter itself replacing p: remaining is
#   (M - N) * ((1 - q) * a + q * b). The filter reads no clock; every cost comes from its
#   arguments.
# The costs a and b are <normal> and <timedOut> (the fit of harness_mutation_costs) when
# both are positive numbers. Otherwise the floor is
# (timeoutMS + overheadMS) / 1000 / concurrency, with overheadMS read from Stryker's
# own `(net N ms, overhead N ms)` dry-run line, which comes before the first counter, and
# b is a + floor. The history rate already contains the timeouts of the runs it came from, so
# with [historyShare] (the percent they made up, harness_mutation_run_share) a is
# <rate> - historyShare / 100 * floor: a run at the history's own share then costs the rate
# per mutant, no timeout counted twice. A non-positive a means the floor overstates what a
# timeout costs there, so the timed-out cost is treated as unknown (the plain line, no
# updates) rather than inventing a normal cost. Without [historyShare] a is <rate>.
# With no floor (no dry-run line, or no concurrency), b is unknown and the filter
# prints the plain first line and no updates. When <rate> is empty or non-positive it
# prints no ETA line and only passes lines through. This is a downstream stage: it NEVER
# changes the exit code — the wrapper reads PIPESTATUS[0] (Stryker), which adding a stage
# does not affect, and a non-numeric argument is a zero, never an error.
harness_mutation_eta_filter() {
  awk -v rate="${1:-}" -v fitNormal="${2:-}" -v fitSlow="${3:-}" -v share="${4:-}" \
      -v timeoutMS="${5:-}" -v concurrency="${6:-}" -v historyShare="${7:-}" '
    # fmtdur mirrors harness_fmt_duration in this same file: <60 -> "Ns";
    # a whole minute -> "Nm"; else "Nm Ss".
    function fmtdur(s,   m) {
      s = int(s + 0.5);
      if (s < 60) return s "s";
      m = int(s / 60); s = s % 60;
      if (s == 0) return m "m";
      return m "m " s "s";
    }
    # Sets normalCost and slowCost (0 when the timed-out cost is unknown).
    function setCosts() {
      normalCost = rate + 0;
      slowCost = 0;
      if (fitNormal + 0 > 0 && fitSlow + 0 > 0) {
        normalCost = fitNormal + 0;
        slowCost = fitSlow + 0;
      } else if (haveOverhead && timeoutMS ~ /^[0-9]+$/ && concurrency ~ /^[0-9]+$/ && concurrency + 0 > 0) {
        timeoutFloor = (timeoutMS + overhead) / 1000 / concurrency;
        if (historyShare ~ /^[0-9]+(\.[0-9]+)?$/ && historyShare + 0 <= 100) {
          normalCost = rate - historyShare / 100 * timeoutFloor;
        }
        if (normalCost > 0) slowCost = normalCost + timeoutFloor;
      }
    }
    {
      print; fflush();
      if (match($0, /overhead [0-9]+ ms\)/)) {
        overhead = substr($0, RSTART + 9) + 0;
        haveOverhead = 1;
      }
      if (rate + 0 <= 0 || !match($0, /[0-9]+\/[0-9]+ tested/)) next;
      split(substr($0, RSTART, RLENGTH), counter, "/");
      tested = counter[1] + 0;
      mutants = counter[2] + 0;
      if (mutants <= 0) next;
      hasTimeouts = match($0, /[0-9]+ timed out\)/);
      if (hasTimeouts) timedOut = substr($0, RSTART, RLENGTH) + 0;
      setCosts();
      if (!announced) {
        if (slowCost > 0 && share ~ /^[0-9]+(\.[0-9]+)?$/ && share + 0 <= 100) {
          p = share / 100;
          printf "Estimated ~%s for %d mutants (~%gs/mutant, %g%% timeouts at ~%gs each, from history)\n", \
            fmtdur(mutants * ((1 - p) * normalCost + p * slowCost)), mutants, normalCost, share + 0, slowCost;
        } else {
          printf "Estimated ~%s for %d mutants (~%gs/mutant from history)\n", \
            fmtdur(rate * mutants), mutants, rate + 0;
        }
        fflush();
        announced = 1;
      }
      boundary = int(tested * 10 / mutants);
      if (hasTimeouts && slowCost > 0 && tested >= 20 && tested <= mutants && timedOut <= tested \
          && boundary > lastBoundary) {
        q = timedOut / tested;
        printf "Estimate at %d%%: ~%s remaining (%.0f%% timeouts so far)\n", \
          boundary * 10, fmtdur((mutants - tested) * ((1 - q) * normalCost + q * slowCost)), q * 100;
        fflush();
        lastBoundary = boundary;
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
    git -C "$root" -c core.quotePath=false ls-files --others --exclude-standard -- '*.ts' '*.tsx' '*.js' 2>/dev/null \
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

# --- The doc-reading jest suites ----------------------------------------------------------------
# Some suites read skill, agent, docs and CLAUDE.md text and fail when it drifts from the code.
# The tier that runs them (medium.sh, and `make doc-suites`) finds them at run time, so a new
# suite needs no list edit.

# harness_doc_roots_pattern : the regex a changed path matches when it is doc text a suite reads.
harness_doc_roots_pattern() {
  printf '%s' '^(harness/kiko/(skills|agents)/|\.claude/skills/|docs/|CLAUDE\.md$)'
}

# harness_doc_suites <root> : the suites under <root>/__tests__ that read a file
# (readFileSync) and name a doc root in a quoted literal, relative to <root>, sorted. Both
# conditions, so a suite that reads files but never a doc (a spawned-bash suite) stays out.
harness_doc_suites() {
  (
    cd "$1" || exit 1
    grep -l readFileSync __tests__/*.test.ts 2>/dev/null \
      | xargs -r grep -l -E "['\"\`](docs/harness/|docs/superpowers/|\.claude/skills|harness/kiko/(skills|agents)|CLAUDE\.md)" 2>/dev/null \
      | LC_ALL=C sort
  )
}

# harness_doc_fingerprint <root> : a hash of the working-tree state of every doc file plus the
# discovered suites' contents. It reads the working tree, not HEAD and a diff, so a committed,
# a staged and an uncommitted edit of the same text give the same value, and a pass recorded
# before a commit still covers it.
harness_doc_fingerprint() {
  local root="$1" pattern file
  local -a docs=() suites=()
  pattern="$(harness_doc_roots_pattern)"
  while IFS= read -r -d '' file; do
    if [[ "$file" =~ $pattern ]] && [ -f "$root/$file" ]; then
      docs+=("$file")
    fi
  done < <(git -C "$root" ls-files -z --cached --others --exclude-standard 2>/dev/null)
  while IFS= read -r file; do
    suites+=("$file")
  done < <(harness_doc_suites "$root")
  {
    printf '%s\n' "${docs[@]+"${docs[@]}"}" "${suites[@]+"${suites[@]}"}"
    git -C "$root" hash-object -- "${docs[@]+"${docs[@]}"}" "${suites[@]+"${suites[@]}"}" 2>/dev/null
  } | harness_hash
}
