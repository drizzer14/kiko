#!/usr/bin/env bash
# Manual check (npm run check:permissions): reports permission path rules that can never
# pre-approve a write or that name the wrong path, and drift between the two user settings files.
# It only reads, and it keeps the caller's cwd because the cwd decides which repository's
# .claude/settings*.json is read. The rules and their sources: permission-doctor.js.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"

fail() {
  # $1 what  $2 details
  print_block \
    "Permission doctor" \
    "$1" \
    "$2" \
    "A protected-path allow rule never pre-approves the write (a rule whose glob can also reach a documented exception, such as .claude/projects/**/memory/**, pre-approves only the excepted part), a single-slash absolute path names a location under the settings source, and a rule only one user settings file holds is lost when the other is read: the prompts keep appearing and nothing says why." \
    "Edit the named settings file by hand and apply the suggested JSON of each finding: remove the rule, replace it with the Markdown or the double-slash form, or add it to the other user settings file. Re-run: npm run check:permissions" \
    "Do not let an agent edit a permission settings file, add more allow rules for a protected path (they cannot work), or weaken the check. The doctor never writes a settings file."
  exit 2
}

out="$(node "$DIR/permission-doctor.js" 2>&1)"
code=$?
case "$code" in
  0) : ;;
  1) fail "Permission rules that cannot work as written, or an unreadable settings file." "$out" ;;
  *) fail "The permission doctor could not run, so the check fails closed." "$out" ;;
esac

exit 0
