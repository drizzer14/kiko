#!/usr/bin/env bash
# Prepares the one shared checkout a queued verify runs in (scripts/job-queue.sh runs it inside the
# job's own process group, with its output in the verify log).
#
# Usage: verify-checkout.sh <repository> <checkout> <sha>
#   <repository> is the main checkout of the repository, <checkout> the path of the linked worktree
#   that holds the sha, <sha> a commit of 7 or more lowercase hex characters.
#
# Silent on success; every failure prints a failure block and exits 2, whatever the failing tool's
# own code was. In order:
#   1. A missing <checkout> becomes a detached linked worktree (`git worktree prune`, then
#      `worktree add --detach`). A folder that exists and is not a linked worktree of <repository>
#      fails and is never deleted.
#   2. The checkout's own index.lock, left by a killed job, is removed: the queue lock means nothing
#      else uses the checkout.
#   3. `git checkout --force --detach <sha>`, then `git clean -ffdx` that keeps /node_modules and
#      /.env.
#   4. An install stamp, node_modules/.kiko-verify-install: a hash of the blob ids of
#      package-lock.json and package.json at the sha, the tree id of patches, and `node --version`.
#      A missing or different stamp runs a plain `npm ci` (its postinstall runs patch-package,
#      ensure-env and ensure-git-hooks, so it never gets --ignore-scripts). The old stamp goes
#      before the install and the new one is written only after it succeeds, so an interrupted
#      install reinstalls and never trusts a half-changed node_modules. A sha without
#      package-lock.json skips the install.
#   5. `node scripts/ensure-env.js` runs on every run, when the file exists: a new .env.example key
#      can arrive with no lock change.
set -uo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIRECTORY/checks/_lib.sh"

CHECK_NAME='verify-checkout.sh'
DO_NOT_TEXT='delete the checkout folder by hand, edit done.log, or add a bypass'
STAMP_NAME='.kiko-verify-install'

# fail <what> <details> <why> <how to fix>
fail() {
  print_block "$CHECK_NAME" "$1" "$2" "$3" "$4" "$DO_NOT_TEXT"
  exit 2
}

if [ "$#" -ne 3 ]; then
  fail \
    'verify-checkout.sh takes exactly three arguments: <repository> <checkout> <sha>' \
    "got $# argument(s): $*" \
    'The prepare step names the repository, the checkout folder and the commit to test.' \
    'Run: bash scripts/verify-checkout.sh <repository> <checkout> <sha>'
fi
repository="$1"
checkout="$2"
requested="$3"

case "$requested" in
  '' | *[!0-9a-f]*)
    fail \
      'The sha is not 7 or more lowercase hex characters' \
      "got: $requested" \
      'A name could move between the enqueue and the start of the job; only a commit id is stable.' \
      'Pass the full commit id of the commit to test.'
    ;;
esac

# The git common directory of $1 as a physical path; fails for a folder that is no repository.
common_directory_of() {
  local common
  common="$(git -C "$1" rev-parse --git-common-dir 2> /dev/null)" || return 1
  (cd "$1" && cd "$common" && pwd -P)
}

repository_common="$(common_directory_of "$repository")" || fail \
  'The repository folder is not a git repository' \
  "$repository" \
  'The checkout is a linked worktree of that repository.' \
  'Queue a worktree of the repository.'

sha="$(git -C "$repository" rev-parse --verify --quiet "${requested}^{commit}" 2> /dev/null)"
case "$sha" in
  "$requested"*) ;;
  *) sha='' ;;
esac
if [ -z "$sha" ]; then
  fail \
    'The sha is not a commit of the repository' \
    "$requested is not a commit of $repository, or it is ambiguous" \
    'Only a commit the repository holds can be checked out and tested.' \
    'Pass a commit of the repository, from git rev-parse HEAD in its worktree.'
fi

# A folder that exists must be a linked worktree of the repository itself: a plain folder, a clone,
# the main checkout, or a worktree of another repository is somebody's files, never deleted here.
require_linked_worktree() {
  local checkout_common top_level
  checkout_common="$(common_directory_of "$checkout")" || checkout_common=''
  top_level="$(git -C "$checkout" rev-parse --show-toplevel 2> /dev/null)" || top_level=''
  if [ "$checkout_common" = "$repository_common" ] && [ -f "$checkout/.git" ] \
    && [ -n "$top_level" ] && [ "$(cd "$top_level" && pwd -P)" = "$(cd "$checkout" && pwd -P)" ]; then
    return 0
  fi
  fail \
    'The checkout path holds something that is not a linked worktree of this repository' \
    "$checkout (git common directory: ${checkout_common:-none}, the repository's: $repository_common)" \
    'The verify checkout is replaced commit by commit, so the script keeps any other folder untouched.' \
    "Move or delete $checkout by hand (the user or the Coordinator decides), then re-queue."
}

if [ -e "$checkout" ] || [ -L "$checkout" ]; then
  require_linked_worktree
else
  output="$(git -C "$repository" worktree prune 2>&1)" || fail \
    'git worktree prune failed' "$output" \
    'A deleted checkout stays registered until it is pruned, and the new one cannot reuse the path.' \
    "Fix the repository state named in DETAILS, then re-queue."
  output="$(git -C "$repository" worktree add -q --detach "$checkout" "$sha" 2>&1)" || fail \
    'git worktree add failed' "$output" \
    'The verify runs in a linked worktree of the repository.' \
    "Fix the cause named in DETAILS, then re-queue."
fi

git_directory="$(git -C "$checkout" rev-parse --absolute-git-dir 2> /dev/null)" || fail \
  'The checkout has no readable git directory' "$checkout" \
  'The script moves the checkout to the sha with git.' \
  "Fix $checkout by hand (the user or the Coordinator decides), then re-queue."
rm -f "$git_directory/index.lock"

output="$(git -C "$checkout" checkout -q --force --detach "$sha" 2>&1)" || fail \
  'git checkout of the sha failed' "$output" \
  'The verify must run on exactly the commit it was queued for.' \
  "Fix the cause named in DETAILS, then re-queue."
output="$(git -C "$checkout" clean -ffdx --exclude=/node_modules --exclude=/.env 2>&1)" || fail \
  'git clean of the checkout failed' "$output" \
  'A leftover file of an earlier run would change what the verify reads.' \
  "Fix the cause named in DETAILS, then re-queue."

# blob_id <path>: the git id of the path at the sha, empty when the sha has no such path.
blob_id() {
  git -C "$checkout" rev-parse --verify --quiet "$sha:$1" 2> /dev/null || true
}

if [ -f "$checkout/package-lock.json" ]; then
  node_version="$(node --version 2> /dev/null)" || node_version=''
  stamp="$(printf '%s\n%s\n%s\n%s\n' "$(blob_id package-lock.json)" "$(blob_id package.json)" \
    "$(blob_id patches)" "$node_version" | git -C "$checkout" hash-object --stdin)" || fail \
    'The install stamp could not be computed' "git hash-object failed in $checkout" \
    'The stamp decides whether node_modules still match the sha.' \
    'Fix the cause named above, then re-queue.'
  stamp_path="$checkout/node_modules/$STAMP_NAME"
  if [ "$(cat "$stamp_path" 2> /dev/null)" != "$stamp" ]; then
    rm -f "$stamp_path"
    (cd "$checkout" && npm ci) || fail \
      'npm ci failed in the checkout' "$checkout, sha $sha; its output is above" \
      'The verify needs node_modules that match the commit.' \
      "Fix the install error above, then re-queue; the next run installs again."
    { mkdir -p "$checkout/node_modules" && printf '%s\n' "$stamp" > "$stamp_path"; } || fail \
      'The install stamp could not be written' "$stamp_path" \
      'Without the stamp the next run installs again, which costs minutes.' \
      'Fix the folder named above, then re-queue.'
  fi
fi

if [ -f "$checkout/scripts/ensure-env.js" ]; then
  (cd "$checkout" && node scripts/ensure-env.js) || fail \
    'node scripts/ensure-env.js failed in the checkout' "$checkout; its output is above" \
    'The jest suites read .env, and a new .env.example key can arrive with no lock change.' \
    'Fix the error above, then re-queue.'
fi
