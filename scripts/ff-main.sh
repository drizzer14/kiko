#!/usr/bin/env bash
# Moves the main checkout forward to one commit, and only to a commit a queued verify passed on.
#
# Usage: ff-main.sh <sha>      (7 to 40 lowercase hex characters; no option, no bypass)
#
# The only inputs are the sha and KIKO_QUEUE_DIR (default $HOME/.claude/kiko-queue), the queue's
# own state folder. Every refusal prints a failure block on stderr and exits 2; on success it runs
# `git merge --ff-only` in the main checkout and prints `git log -1 --oneline` there. In order:
#   1. The main checkout is the first `worktree` entry of `git worktree list --porcelain` of this
#      script's own repository (git's main worktree), never a hardcoded path. It must be on the
#      branch main.
#   2. The sha is resolved to its full 40 characters in that repository, and the full commit must
#      start with the argument (a branch named like a short sha cannot redirect it).
#   3. done.log (scripts/job-queue.sh writes it) must hold a `verify` line whose 6th field, the
#      HEAD the queue tested (a clean tree at START and at the end, HEAD unmoved), equals the full
#      commit. The LAST such line decides, so a red verify after a green one at the same commit
#      blocks. A `check-all` or `gate` line, a line whose head is `unknown`, and an old 5-field
#      line never count; neither does a LOST line (`lost <label> ...` or `<kind> <label> lost ...`,
#      written by job-queue.sh for a job whose result was never recorded). A line with fewer than
#      6 fields is ignored: those before the first 6-field line print ONE WARNING on stderr
#      (count and the last such line), each one after it prints its own with its line number.
#   4. The main checkout's HEAD must be an ancestor of the commit.
#   5. A commit that changes harness/kiko (other than harness/kiko/.claude-plugin/plugin.json)
#      against the main checkout's HEAD must carry a plugin.json `version` strictly above the one
#      at main's HEAD (numeric dotted compare), because a plugin update only reaches running
#      sessions under a new version. An unreadable or missing version at either commit refuses.
#   6. A commit whose plugin.json `version` is strictly below the one at main's HEAD, or whose
#      plugin.json is missing or unreadable while main's is readable, is refused whatever the diff.
#      An equal or higher version, or no readable version at main, passes this rule.
#   7. The fast-forward merges the full commit, so main moving between these checks and the merge
#      makes git refuse instead of moving main elsewhere. A dirty main checkout is not checked:
#      git itself refuses a fast-forward that would overwrite a local change.
#
# Known limit: a hand-written done.log line passes. The file belongs to cooperating agents and is
# not defended against one that forges it. Its blocks say "DO NOT edit done.log".
set -uo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIRECTORY/checks/_lib.sh"

CHECK_NAME='ff-main.sh'
DO_NOT_TEXT='edit done.log, merge main by hand, or add a bypass; an override goes to the user plus a run-log note'
DONE_LOG="${KIKO_QUEUE_DIR:-${HOME:-}/.claude/kiko-queue}/done.log"

# fail <what> <details> <why> <how to fix>
fail() {
  print_block "$CHECK_NAME" "$1" "$2" "$3" "$4" "$DO_NOT_TEXT"
  exit 2
}

valid_commit() {
  case "$1" in
    '' | *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -ge 7 ] && [ "${#1}" -le 40 ]
}

if [ "$#" -ne 1 ] || ! valid_commit "$1"; then
  fail \
    'ff-main.sh takes exactly one argument: a commit sha of 7 to 40 lowercase hex characters' \
    "got $# argument(s): $*" \
    'Main moves to one verified commit; an option, a second argument, or a name has no meaning here.' \
    'Run: bash scripts/ff-main.sh <sha>'
fi
requested="$1"

main_checkout="$(git -C "$SCRIPT_DIRECTORY" worktree list --porcelain 2> /dev/null \
  | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
if [ -z "$main_checkout" ] || [ ! -d "$main_checkout" ]; then
  fail \
    'The main checkout cannot be found' \
    "git worktree list --porcelain in $SCRIPT_DIRECTORY named: ${main_checkout:-nothing}" \
    'The script moves the first worktree of its own repository, and without it there is nothing to move.' \
    'Run the script from a checkout of the repository: bash scripts/ff-main.sh <sha>'
fi

current_branch="$(git -C "$main_checkout" symbolic-ref --short HEAD 2> /dev/null)"
if [ "$current_branch" != main ]; then
  fail \
    'The main checkout is not on branch main' \
    "$main_checkout is ${current_branch:+on branch $current_branch}${current_branch:-on a detached HEAD}" \
    'A fast-forward moves whatever branch the main checkout holds, so it must hold main.' \
    "Put $main_checkout back on branch main (the user or the Coordinator decides), then re-run."
fi

full_commit="$(git -C "$main_checkout" rev-parse --verify --quiet "${requested}^{commit}" 2> /dev/null)"
case "$full_commit" in
  "$requested"*) ;;
  *) full_commit='' ;;
esac
if [ -z "$full_commit" ]; then
  fail \
    'The argument does not name a commit' \
    "$requested is not a commit of the repository at $main_checkout, or it is ambiguous" \
    'Only a commit the repository holds can have been verified.' \
    'Pass the sha of the tip you verified, from git rev-parse HEAD in its worktree.'
fi

# A line with fewer than 6 fields never counts below; the warning keeps that from being silent. The
# short lines before the first 6-field line (the old block of a log that predates the head field)
# fold into one summary WARNING, so that block cannot bury a later torn line; each short line after
# it keeps its own WARNING. The awk text is the same as scripts/job-queue.sh's.
awk '
  function flush_leading() {
    if (leading > 0) printf "WARNING: %d done.log line(s) with fewer than 6 fields before the first 6-field line (ignored); the last: %s\n", leading, last_leading
    leading = 0
  }
  NF >= 6 { flush_leading(); seen = 1; next }
  NF > 0 && seen { print "WARNING: done.log line " NR " has fewer than 6 fields (ignored): " $0; next }
  NF > 0 { leading++; last_leading = $0 }
  END { flush_leading() }
' "$DONE_LOG" >&2 2> /dev/null

# A string comparison on purpose: a field of digits and one `e` would otherwise compare as a number.
verified_line="$(awk -v commit="$full_commit" \
  '$1 == "verify" && NF >= 6 && ($6 "") == (commit "") { line = $0 } END { if (line != "") print line }' \
  "$DONE_LOG" 2> /dev/null)"
verified_exit="$(printf '%s\n' "$verified_line" | awk '{ print $3 }')"
if [ -z "$verified_line" ] || [ "$verified_exit" != 0 ]; then
  fail \
    'No successful queued verify at this commit' \
    "$DONE_LOG, last verify line for it: ${verified_line:-none}" \
    'Main moves only to a commit a queued verify passed on, so an unverified commit never reaches it.' \
    "Queue: bash scripts/job-queue.sh verify <clean worktree at $full_commit> <label>, wait for exit 0 (a tree changed at START or at the end, or a moved HEAD, is recorded as unknown and does not count), then re-run bash scripts/ff-main.sh $requested"
fi

if ! git -C "$main_checkout" merge-base --is-ancestor HEAD "$full_commit" 2> /dev/null; then
  fail \
    'The main checkout is not an ancestor of this commit' \
    "main at $main_checkout is at $(git -C "$main_checkout" rev-parse HEAD 2> /dev/null), which $full_commit does not contain" \
    'Only a fast-forward is allowed, and a commit that lacks main would drop its work.' \
    'Merge main into the branch, queue a verify at the new tip, then re-run with its sha.'
fi

PLUGIN_MANIFEST='harness/kiko/.claude-plugin/plugin.json'

# plugin_version <rev>: the dotted numeric `version` of the manifest at that commit, else nothing.
plugin_version() {
  git -C "$main_checkout" show "$1:$PLUGIN_MANIFEST" 2> /dev/null \
    | sed -n '/.*"version"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\(\.[0-9][0-9]*\)*\)".*/{s//\1/p;q;}'
}

# version_above <candidate> <base>: succeeds when candidate is strictly above base, field by field.
version_above() {
  awk -v candidate="$1" -v base="$2" 'BEGIN {
    candidate_count = split(candidate, candidate_fields, ".")
    base_count = split(base, base_fields, ".")
    count = candidate_count > base_count ? candidate_count : base_count
    for (index_field = 1; index_field <= count; index_field++) {
      candidate_value = candidate_fields[index_field] + 0
      base_value = base_fields[index_field] + 0
      if (candidate_value != base_value) exit(candidate_value > base_value ? 0 : 1)
    }
    exit 1
  }'
}

main_commit="$(git -C "$main_checkout" rev-parse HEAD 2> /dev/null)"
git -C "$main_checkout" diff --quiet "$main_commit" "$full_commit" \
  -- harness/kiko ":!$PLUGIN_MANIFEST" 2> /dev/null
harness_changed=$?
main_version="$(plugin_version "$main_commit")"
commit_version="$(plugin_version "$full_commit")"
if [ "$harness_changed" -ne 0 ]; then
  if [ -z "$main_version" ] || ! version_above "$commit_version" "$main_version"; then
    fail \
      'A harness/kiko change needs a plugin.json version above main'"'"'s' \
      "$PLUGIN_MANIFEST version at main ${main_commit}: ${main_version:-unreadable or missing}; at $full_commit: ${commit_version:-unreadable or missing}" \
      'A plugin update reaches running sessions only under a new version, so an unbumped harness change never goes live.' \
      "Bump $PLUGIN_MANIFEST to the next free patch above ${main_version:-the version at main}, queue a verify at the new tip, then re-run with its sha."
  fi
fi

if [ -n "$main_version" ] && { [ -z "$commit_version" ] || version_above "$main_version" "$commit_version"; }; then
  fail \
    'A plugin.json version below main'"'"'s is refused' \
    "$PLUGIN_MANIFEST version at main ${main_commit}: ${main_version}; at $full_commit: ${commit_version:-unreadable or missing}" \
    'A lowered or removed version hides a plugin update from running sessions that already hold main'"'"'s version.' \
    "Restore a $PLUGIN_MANIFEST version at or above $main_version, queue a verify at the new tip, then re-run with its sha."
fi

if ! merge_output="$(git -C "$main_checkout" merge --ff-only "$full_commit" 2>&1)"; then
  fail \
    'git merge --ff-only refused' \
    "$(printf '%s' "$merge_output" | tr '\n' ' ')" \
    'git refuses a fast-forward that would overwrite a local change in the main checkout.' \
    "Resolve the change named in DETAILS in $main_checkout (the user or the Coordinator decides), then re-run."
fi
printf '%s\n' "$merge_output"
git -C "$main_checkout" log -1 --oneline
