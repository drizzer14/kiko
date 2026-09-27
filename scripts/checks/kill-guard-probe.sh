#!/usr/bin/env bash
# Runs ONE sentinel probe in a real bash or zsh, so a kill-guard change can
# be checked against what the shell really executes. Not a check wrapper
# and not wired to any hook: a manual tool for guard work (see
# kill-guard.js's `decide`).
#
# Why sentinels: a reviewer probe once ran a real pkill because its runner
# only rewrote the word `pkill`, and `pk\<newline>ill x` joined back into
# the real command. A runner that stubs the real kill commands can still be
# escaped (a child shell, a PATH change, a built command word), so a probe
# here never names a real kill command or the real main checkout at all:
#   - the caller writes the sentinel `kg_sentinel_target` wherever a kill
#     command would be, and a scratch folder wherever the main checkout
#     would be, and judges the same text with kill-guard's
#     `decide(text, { sentinelKillCommands: ['kg_sentinel_target'],
#     mainCheckoutPath: <scratch folder> })`;
#   - the sentinel and git are stub scripts first on PATH that only append
#     what they received (git also its working directory) to a log. No
#     real command has the sentinel's name, so a probe that escapes the
#     stub (a child shell, a PATH edit, a background job that outlives the
#     runner and its stubs) finds no sentinel to run;
#   - real git is NOT out of reach: a PATH edit or /usr/bin/git still finds
#     it. It runs in the runner's empty scratch folder, which is no
#     repository, and the main checkout cannot be named (below);
#   - this runner REFUSES probe text that holds `kill` (so pkill, killall,
#     and kill) or `pff-ios` (the main checkout's folder) in any spelling
#     the shell would rebuild: letter case folded, line continuations
#     joined, the quoting and expansion marks $ ' " \ { } , ` ( ) dropped,
#     and `/./` and `//` path segments collapsed. A word the probe builds at
#     run time (`a=pk; ${a}ill`) is beyond any text check: callers write
#     the sentinel, never a kill word.
# The probe runs with `eval`, as the Bash tool runs a command, in an empty
# scratch folder under a clean environment, with stdin from /dev/null. The
# runner waits until every process still holding the probe's output has
# finished, up to a hard time limit (KIKO_PROBE_TIMEOUT, default 5 s).
#
# Usage:  kill-guard-probe.sh bash|zsh '<probe text>'
# Output: one `STUB kg_sentinel_target <arguments>` or
#         `STUB git cwd=<folder> <arguments>` line per stub call, then
#         `EXIT <status>` (the probe shell's own exit status).
# Exit:   0 the probe ran; 2 usage error or refused probe text.
# Test-only: KIKO_PROBE_REFUSE_ALSO adds space-separated words to the
# refusal list, so its tests prove every spelling with the sentinel and a
# fake folder instead of handing it a real kill word or the real path.
set -euo pipefail

SENTINEL=kg_sentinel_target
REFUSED=(kill pff-ios)

usage() {
  echo "usage: kill-guard-probe.sh bash|zsh '<probe text>'" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
case "$1" in
  bash) SHELL_COMMAND=(/bin/bash -c) ;;
  zsh) SHELL_COMMAND=(/bin/zsh -f -c) ;;
  *) usage ;;
esac
PROBE=$2

# The text as the shell will rebuild its words (see the header).
normalize() {
  printf '%s' "$1" |
    /usr/bin/perl -0pe 's/\\\n//g; s/[\$\x27"\\{},`()]//g; $_ = lc; 1 while s{/\./}{/}; s{/+}{/}g'
}

if [ -n "${KIKO_PROBE_REFUSE_ALSO:-}" ]; then
  read -r -a EXTRA <<<"$KIKO_PROBE_REFUSE_ALSO"
  REFUSED+=("${EXTRA[@]}")
fi
NORMALIZED=$(normalize "$PROBE")
for word in "${REFUSED[@]}"; do
  case "$NORMALIZED" in
    *"$(normalize "$word")"*)
      echo "kill-guard-probe: refused: the probe text names a kill command or the real main" \
        "checkout; write $SENTINEL and a scratch folder instead" >&2
      exit 2
      ;;
  esac
done

LIMIT=${KIKO_PROBE_TIMEOUT:-5}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/kill-guard-probe.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
STUBS="$WORK/stubs"
LOG="$WORK/stub.log"
mkdir "$STUBS" "$WORK/cwd"
: >"$LOG"

# A stub logs its first line (`header`, shell code writing to "$log"), then
# each argument, and runs nothing else.
write_stub() {
  local name=$1 header=$2
  {
    echo '#!/bin/sh'
    printf 'log=%q\n' "$LOG"
    echo "$header"
    echo 'for argument in "$@"; do printf " %s" "$argument" >> "$log"; done'
    echo 'printf "\n" >> "$log"'
    echo 'exit 0'
  } >"$STUBS/$name"
  chmod +x "$STUBS/$name"
}

write_stub "$SENTINEL" "printf 'STUB $SENTINEL' >> \"\$log\""
write_stub git 'printf "STUB git cwd=%s" "$PWD" >> "$log"'

set +e
cd "$WORK/cwd"
env -i HOME="$WORK" PATH="$STUBS:/usr/bin:/bin" KIKO_PROBE_COMMAND="$PROBE" \
  /usr/bin/perl -e 'alarm shift; exec @ARGV or exit 127' "$LIMIT" \
  "${SHELL_COMMAND[@]}" 'eval "$KIKO_PROBE_COMMAND"' </dev/null 2>&1 |
  /usr/bin/perl -e 'alarm shift; 1 while <STDIN>' "$((LIMIT + 2))"
STATUS=${PIPESTATUS[0]}
set -e

cat "$LOG"
echo "EXIT $STATUS"
