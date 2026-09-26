#!/usr/bin/env bash
# Plugin hook dispatcher (harness/kiko/hooks/hooks.json). Every hook entry
# invokes THIS script instead of a hardcoded "${CLAUDE_PROJECT_DIR}/scripts/
# checks/<script>.sh", because CLAUDE_PROJECT_DIR is the COORDINATOR's own
# checkout for a subagent's hook call — a subagent started in the main repo
# but editing a file that lives in a DIFFERENT worktree would otherwise run
# the main repo's scripts/rules against a file it does not own (a real Class
# A finding was missed this way, and the pre-write guard would have treated
# every worktree edit as "outside the project" and allowed it unchecked).
# See docs/superpowers/specs/2026-09-25-pre-write-guard-design.md ("Trigger
# and wiring") for the full write-up of why this indirection exists.
#
# Usage: dispatch.sh <script-name>   (script-name: a bare "*.sh" basename
# that hooks.json passes literally, e.g. "pre-write-guard.sh"). Validated
# below so this argument can never be turned into a path escape out of
# scripts/checks/ (a slash or a ".." segment), even though hooks.json only
# ever supplies a fixed literal today.
#
# Root resolution, in order:
#   1. Edit/Write/MultiEdit (tool_input.file_path present in the hook JSON
#      on stdin): the nearest EXISTING ancestor directory of file_path's own
#      `git rev-parse --show-toplevel` (a brand-new file's own directory may
#      not exist on disk yet, so this walks up until it finds one that
#      does).
#   2. Anything else (Bash, Stop, SubagentStop — no tool_input.file_path):
#      the payload's own `cwd` field, used as-is (Claude Code already sets
#      it to the session's own working directory; no git resolution needed
#      there).
#   3. Fallback: CLAUDE_PROJECT_DIR, when neither of the above yields a
#      value (a missing field, or `git rev-parse` failing because the
#      directory is not inside any repository at all).
#
# Once resolved: exec the target script (scripts/checks/<script-name> under
# that root) with CLAUDE_PROJECT_DIR set to that SAME root, replaying the
# original stdin bytes unchanged, and pass its stdout/stderr/exit code
# through untouched. The "script absent" case (root has no such file) is a
# silent no-op (exit 0) for every hook, matching the existing pre-write
# guard's own `[ -f "$f" ] || exit 0` convention generalized to all four.
#
# Fail-closed by DELEGATION, not duplication: a malformed JSON payload, a
# `git rev-parse` failure, or `node` itself being unavailable all degrade to
# "extract nothing, fall back to CLAUDE_PROJECT_DIR, still invoke the target
# script" rather than a bespoke deny path here — each target script already
# has its own tested contract for exactly that input (pre-write-guard.sh
# already denies on malformed JSON or a node crash; kill-guard.sh already
# always exits 0). Replaying the same bytes through the fallback root reaches
# that SAME contract, so the required outcome (a crash denies for
# pre-write-guard.sh; the other hooks keep their current fail-open semantics)
# holds without a second copy of that logic here. The one genuine
# dispatcher-own crash this cannot delegate away is failing to even BUFFER
# stdin (mktemp itself failing) — see the stdinFile check below, the only
# spot with bespoke per-script-name behavior.
set -uo pipefail

scriptName="${1:-}"

# A dispatcher-own crash denies for the write guard (never let a broken
# guard allow an unchecked write) and no-ops for every other hook (matching
# kill-guard.sh's own "always exit 0" contract and fast.sh/medium.sh's own
# "nothing determinable, so exit 0" convention on malformed input).
denyOrNoop() {
  reason="$1"

  if [ "$scriptName" = "pre-write-guard.sh" ]; then
    escapedReason="$(printf '%s' "$reason" | tr '\n\r\t' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$escapedReason"
    printf '%s\n' "$reason" >&2
    exit 2
  fi

  exit 0
}

# Defense in depth around the one argument this script trusts from its
# caller: reject anything that is not a plain "name.sh" basename, so this
# can never be coaxed into reaching outside scripts/checks/. hooks.json only
# ever passes a fixed literal, so this path is unreachable in normal
# operation — a hard, unconditional reject (never delegated to
# denyOrNoop's per-script table) is correct here because an invalid argument
# is a dispatcher MISCONFIGURATION, not a runtime payload to gracefully
# degrade from.
case "$scriptName" in
  '')
    printf 'dispatch.sh: missing script-name argument\n' >&2
    exit 2
    ;;
esac
case "$scriptName" in
  */*)
    printf 'dispatch.sh: invalid script-name (contains a slash): %s\n' "$scriptName" >&2
    exit 2
    ;;
esac
case "$scriptName" in
  *..*)
    printf 'dispatch.sh: invalid script-name (contains ..): %s\n' "$scriptName" >&2
    exit 2
    ;;
esac
case "$scriptName" in
  *[!A-Za-z0-9._-]*)
    printf 'dispatch.sh: invalid script-name (disallowed character): %s\n' "$scriptName" >&2
    exit 2
    ;;
esac
case "$scriptName" in
  *.sh) : ;;
  *)
    printf 'dispatch.sh: invalid script-name (must end in .sh): %s\n' "$scriptName" >&2
    exit 2
    ;;
esac

# Buffer stdin to a temp file (never `$(cat)`, which strips trailing
# newlines) so the exact bytes can be replayed to the target script below.
# This mktemp call is the one genuine dispatcher-own crash point: if it
# fails, nothing downstream is safely repeatable.
stdinFile="$(mktemp 2>/dev/null)"
if [ -z "$stdinFile" ] || [ ! -f "$stdinFile" ]; then
  denyOrNoop 'dispatch.sh: could not buffer stdin (mktemp failed)'
fi
trap 'rm -f "$stdinFile"' EXIT
cat > "$stdinFile" 2>/dev/null

# Parse the payload with node (the existing hooks already rely on node —
# kill-guard.js, pre-write-guard.js — so this adds no new tool dependency;
# no jq). Never throws: a malformed payload or a missing field yields two
# empty lines, which the root-resolution steps below treat as "not present"
# and fall through the same way a truly absent field would.
resolverOutput="$(node -e '
  const fs = require("node:fs");
  let filePath = "";
  let cwd = "";
  try {
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const payload = JSON.parse(raw);
    if (payload.tool_input && typeof payload.tool_input.file_path === "string") {
      filePath = payload.tool_input.file_path;
    }
    if (typeof payload.cwd === "string") {
      cwd = payload.cwd;
    }
  } catch {}
  process.stdout.write(filePath + "\n" + cwd + "\n");
' "$stdinFile" 2>/dev/null)"
filePath="$(printf '%s\n' "$resolverOutput" | sed -n '1p')"
cwd="$(printf '%s\n' "$resolverOutput" | sed -n '2p')"

# Resolves the git worktree root for an EXISTING directory. Echoes the root
# and returns 0 on success. Returns 1 when git's own failure text says "not
# a git repository" (a plain, non-repo directory is not a dispatcher
# crash, so the caller falls back to CLAUDE_PROJECT_DIR below). Returns 2
# on any OTHER git failure (the git binary itself misbehaving, a corrupt
# .git, a permission error) — I2: silently falling back on THIS case used
# to let an unchecked write through for pre-write-guard.sh, so the caller
# escalates it to denyOrNoop instead of treating it the same as "no repo
# here".
resolveGitRootOrFail() {
  targetDirectory="$1"
  gitErrorFile="$(mktemp 2>/dev/null)"
  if [ -z "$gitErrorFile" ]; then
    return 2
  fi
  gitRootValue="$(git -C "$targetDirectory" rev-parse --show-toplevel 2>"$gitErrorFile")"
  gitStatus=$?
  gitErrorText="$(cat "$gitErrorFile" 2>/dev/null)"
  rm -f "$gitErrorFile"
  if [ "$gitStatus" -eq 0 ] && [ -n "$gitRootValue" ]; then
    printf '%s' "$gitRootValue"
    return 0
  fi
  case "$gitErrorText" in
    *"not a git repository"*)
      return 1
      ;;
    *)
      return 2
      ;;
  esac
}

resolvedRoot=""
gitFailureIsOther=0

if [ -n "$filePath" ]; then
  directory="$(dirname "$filePath")"
  # Walk up to the nearest EXISTING ancestor — a brand-new file's own
  # directory (and any number of its new parent directories) may not exist
  # on disk yet, but `git rev-parse` needs a real directory to `-C` into.
  while [ ! -d "$directory" ] && [ "$directory" != "/" ]; do
    parent="$(dirname "$directory")"
    if [ "$parent" = "$directory" ]; then
      break
    fi
    directory="$parent"
  done
  if [ -d "$directory" ]; then
    gitRoot="$(resolveGitRootOrFail "$directory")"
    case $? in
      0) resolvedRoot="$gitRoot" ;;
      2) gitFailureIsOther=1 ;;
    esac
  fi
elif [ -n "$cwd" ]; then
  # C1: `cwd` used to be trusted as-is. A Bash/Stop payload's own `cwd` can
  # be a SUBDIRECTORY of the repo (e.g. `<root>/ios`, which the scope
  # excludes but a session can still `cd` into) — trusting it verbatim then
  # looks for `<root>/ios/scripts/checks/<script>`, which never exists, so
  # the hook silently no-ops (fails OPEN) instead of finding the real script
  # one level up. Resolve `cwd`'s own git root the same way file_path's
  # directory is resolved above.
  if [ -d "$cwd" ]; then
    gitRoot="$(resolveGitRootOrFail "$cwd")"
    case $? in
      0) resolvedRoot="$gitRoot" ;;
      2) gitFailureIsOther=1 ;;
    esac
  fi
fi

if [ "$gitFailureIsOther" -eq 1 ]; then
  denyOrNoop 'dispatch.sh: git rev-parse failed resolving the target root (a genuine git failure, not a plain non-repo directory)'
fi

if [ -z "$resolvedRoot" ]; then
  resolvedRoot="${CLAUDE_PROJECT_DIR:-}"
fi

targetScript="$resolvedRoot/scripts/checks/$scriptName"
if [ ! -f "$targetScript" ]; then
  exit 0
fi

CLAUDE_PROJECT_DIR="$resolvedRoot" bash "$targetScript" < "$stdinFile"
exit $?
