#!/usr/bin/env bash
# Runs ONE kill-guard probe string in a real bash or zsh, so a guard change
# can be checked against what the shell really executes — without letting
# the probe signal anything. Not a check wrapper and not wired to any hook:
# a manual tool for guard work (see kill-guard.js).
#
# Why it exists: a reviewer probe once ran a real pkill on the machine. Its
# runner only rewrote the word `pkill` to a stub, and `pk\<newline>ill x`
# joined back into /usr/bin/pkill inside the shell. A string rewrite can
# never be trusted, so this runner stubs the commands themselves:
#   - pkill, killall, kill, and xargs are stub scripts FIRST on PATH; each
#     only appends its name and arguments to a log. So is git, so a probed
#     `git stash` or `git merge` never touches a real repository, and the
#     probe runs in an empty scratch directory;
#   - the shell's own kill builtin is disabled (`enable -n kill` in bash,
#     `disable kill` in zsh), so `kill` also resolves to the stub;
#   - inside the probe shell, before the probe runs, it checks that the stub
#     dir is first on PATH and that all four names resolve to the stubs, and
#     REFUSES to run the probe otherwise;
#   - probe text that could reach past the stubs (an absolute path, PATH=,
#     command -p, enable, builtin, hash, env, sudo, or a language
#     interpreter) is refused before any shell starts.
# Each probe runs with `eval`, as the Bash tool runs a command, under a
# clean environment, with stdin from /dev/null and a time limit.
#
# Usage:   kill-guard-probe.sh bash|zsh '<probe text>'
# Output:  one `STUB <name> <arguments>` line per stub call, then
#          `EXIT <status>` (the probe shell's own exit status).
# Exit:    0 the probe ran; 2 usage error or refused probe text;
#          3 refused to run (stubs not first on PATH, or the kill builtin
#          still enabled).
# Test-only seams: KIKO_PROBE_SKIP_DISABLE=1 skips disabling the builtin,
# and KIKO_PROBE_PATH_BEFORE_SHIMS puts a directory before the stubs. Both
# only exist to prove the runner then refuses; neither can make it run a
# probe unsafely. KIKO_PROBE_TIMEOUT sets the time limit (default 5 s).
set -euo pipefail

usage() {
  echo "usage: kill-guard-probe.sh bash|zsh '<probe text>'" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
case "$1" in
  bash) SHELL_BINARY=/bin/bash; DISABLE_BUILTIN='enable -n kill || exit 90' ;;
  zsh) SHELL_BINARY=/bin/zsh; DISABLE_BUILTIN='disable kill || exit 90' ;;
  *) usage ;;
esac
PROBE=$2
if [ "${KIKO_PROBE_SKIP_DISABLE:-}" = 1 ]; then DISABLE_BUILTIN=':'; fi

# Line continuations joined and quotes dropped, so `pk\<newline>ill` and
# `/u''sr/bin/pkill` read as what the shell will run.
NORMALIZED=$(printf '%s' "$PROBE" | /usr/bin/perl -0pe 's/\\\n//g; s/["'\''\\]//g')
BYPASS='/(usr/)?s?bin/|PATH=|command[[:space:]]+-p|(^|[^[:alnum:]_-])(enable|builtin|hash|env|sudo|doas|su|python[0-9.]*|perl|ruby|node|osascript|launchctl)([^[:alnum:]_-]|$)'
if printf '%s' "$NORMALIZED" | grep -Eq "$BYPASS"; then
  echo "kill-guard-probe: refused: the probe text could reach a real kill past the stubs" \
    "(an absolute path, PATH=, command -p, enable, builtin, hash, env, sudo, or an interpreter)" >&2
  exit 2
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/kill-guard-probe.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
SHIMS="$WORK/shims"
LOG="$WORK/stub.log"
READY="$WORK/ready"
mkdir "$SHIMS" "$WORK/cwd"
: >"$LOG"
STUBBED='pkill killall kill xargs git'

for name in $STUBBED; do
  {
    echo '#!/bin/sh'
    printf 'log=%q\n' "$LOG"
    printf 'printf "STUB %s" >> "$log"\n' "$name"
    echo 'for argument in "$@"; do printf " %s" "$argument" >> "$log"; done'
    echo 'printf "\n" >> "$log"'
    echo 'exit 0'
  } >"$SHIMS/$name"
  chmod +x "$SHIMS/$name"
done

PROBE_PATH="$SHIMS:/usr/bin:/bin"
if [ -n "${KIKO_PROBE_PATH_BEFORE_SHIMS:-}" ]; then
  PROBE_PATH="$KIKO_PROBE_PATH_BEFORE_SHIMS:$PROBE_PATH"
fi

# Runs inside the probe shell: every check must pass before the READY file
# exists and before the probe text is evaluated.
CHECKS='[ "${PATH%%:*}" = "$KIKO_PROBE_SHIMS" ] || exit 90
for name in pkill killall kill xargs git; do
  [ "$(command -v "$name")" = "$KIKO_PROBE_SHIMS/$name" ] || exit 90
done
: > "$KIKO_PROBE_READY"
unset KIKO_PROBE_READY
eval "$KIKO_PROBE_COMMAND"'

SHELL_FLAGS=(-c)
if [ "$1" = zsh ]; then SHELL_FLAGS=(-f -c); fi

set +e
cd "$WORK/cwd"
env -i HOME="$WORK" PATH="$PROBE_PATH" \
  KIKO_PROBE_SHIMS="$SHIMS" KIKO_PROBE_READY="$READY" KIKO_PROBE_COMMAND="$PROBE" \
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "${KIKO_PROBE_TIMEOUT:-5}" \
  "$SHELL_BINARY" "${SHELL_FLAGS[@]}" "$DISABLE_BUILTIN
$CHECKS" </dev/null >/dev/null 2>&1
STATUS=$?
set -e

if [ ! -e "$READY" ]; then
  echo "kill-guard-probe: refused to run: the stubs are not first on PATH, or the $1 kill builtin" \
    "could not be disabled" >&2
  exit 3
fi
cat "$LOG"
echo "EXIT $STATUS"
