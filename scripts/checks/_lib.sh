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
