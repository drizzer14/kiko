#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/_lib.sh"
ROOT="$(cd "$DIR/../.." && pwd)"
BIN="$ROOT/node_modules/.bin/jscpd"

if [ ! -x "$BIN" ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "The jscpd tool is not installed in node_modules." \
    "$BIN was not found or is not executable." \
    "The harness tools live in node_modules. Without them, no check can run, and a missing tool must not look like a code problem." \
    "Run: npm install   then re-run: npm run check:dup" \
    "Do not run jscpd through npx without --no-install (that auto-fetches jscpd@5 from the network). Install the pinned version with npm install."
  exit 2
fi

# Scope: paths passed as args (changed-files scope), else the whole repo.
paths=("$@"); [ ${#paths[@]} -eq 0 ] && paths=(".")

# Dedup only an explicit set of files (the changed-files scope), keyed on
# the set identity. jscpd detects duplication within the given set, so its
# result depends only on those files' contents plus .jscpd.json and the
# pinned jscpd version (captured by package-lock.json). The whole-repo
# manual run ("." with no args) always runs.
dkey=""; fp=""
if [ "$#" -gt 0 ]; then
  allfiles=1
  for p in "$@"; do [ -f "$p" ] || allfiles=0; done
  if [ "$allfiles" -eq 1 ]; then
    sorted="$(printf '%s\n' "$@" | sort -u)"
    dkey="dup:$(printf '%s' "$sorted" | harness_hash)"
    fp="$( { printf '%s\n' "$sorted" | while IFS= read -r p; do shasum "$p" 2>/dev/null; done
            shasum "$ROOT/.jscpd.json" 2>/dev/null
            shasum "$ROOT/package-lock.json" 2>/dev/null; } | harness_hash )"
    if harness_unchanged "$ROOT" "$dkey" "$fp"; then
      exit 0
    fi
  fi
fi

out="$("$BIN" "${paths[@]}" 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  print_block \
    "jscpd (copy/paste detection)" \
    "jscpd found duplicated code above the configured threshold." \
    "$out" \
    "Duplicated blocks are a common LLM failure mode: copy-pasting instead of extracting a shared function. Duplication multiplies bug surface and drifts out of sync." \
    "Extract the shared block into one function or module and call it from both places. Re-run: npm run check:dup" \
    "Do not rename a variable to trick jscpd. Extract the shared block into one function."
  exit 2
fi
[ -n "$dkey" ] && harness_mark_pass "$ROOT" "$dkey" "$fp"

# Second, NON-blocking pass. jscpd skips a file over maxLines (1000) or maxSize (100kb) without a
# word, so the blocking run above never measured those files. Its file selection (the config's
# ignore list, .gitignore, the format filter) is the only thing that knows which files are in
# scope, so ask it: `--debug` lists the selected files and runs no detection. The files in the
# list made with the limits raised but not in the default list are exactly the ones the blocking
# run skipped for size. Each is measured ALONE with the limits raised, because a run of the whole
# set attributes a clone to whichever file jscpd stores first, which makes a file's percentage
# depend on its neighbours. Over the threshold is a WARNING on stderr and the exit code stays 0:
# the sweep of those files is tracked debt (docs/harness/documented-exceptions.md), and it flips
# this pass to a failure. This runs after the dedup mark on purpose: warnings never decide
# the pass, and a dedup skip above (same file contents, same config) prints nothing again.
RAISED_LIMITS=(--max-lines 2147483647 --max-size 1gb)

# listed_files <extra jscpd option>... : one in-scope file path per line, sorted. A jscpd failure
# returns non-zero; an empty scope is a valid empty list.
listed_files() {
  local listing
  listing="$("$BIN" "${paths[@]}" --debug --no-colors "$@" 2>/dev/null)" || return 1
  printf '%s\n' "$listing" | while IFS= read -r line; do
    if [ -f "$line" ]; then printf '%s\n' "$line"; fi
  done | sort -u
}

# A failure to LIST warns and never silences: the blocking pass already failed closed on a real
# jscpd crash, but the large files must not go unmeasured without a trace.
if ! default_list="$(listed_files)" || ! raised_list="$(listed_files "${RAISED_LIMITS[@]}")"; then
  printf 'WARNING: check:dup could not list the files it skipped for size: jscpd --debug failed.\n' >&2
  exit 0
fi
skipped="$(comm -13 <(printf '%s\n' "$default_list") <(printf '%s\n' "$raised_list"))"
[ -z "$skipped" ] && exit 0

threshold="$(node -p "require('$ROOT/.jscpd.json').threshold" 2>/dev/null)"
[ -z "$threshold" ] && threshold=5
report_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiko-dup-large.XXXXXX")"
trap 'rm -rf "$report_dir"' EXIT

# measure_one <number> <file> : writes the file's WARNING line, if any, to
# "$report_dir/<number>.warning".
measure_one() {
  local number="$1" file="$2" shown measured
  shown="${file#"$ROOT"/}"
  # --threshold 100 keeps jscpd's own threshold reporter from exiting non-zero on a big
  # percentage, so a non-zero exit here means jscpd itself failed.
  if ! "$BIN" "$file" --silent --no-colors -r json -o "$report_dir/$number" -t 100 \
    "${RAISED_LIMITS[@]}" >/dev/null 2>&1; then
    printf 'WARNING: check:dup could not measure %s: jscpd failed on it.\n' "$shown" > "$report_dir/$number.warning"
    return
  fi
  measured="$(node -p "const t = require('$report_dir/$number/jscpd-report.json').statistics.total; t.lines > 0 ? t.percentage : ''" 2>/dev/null)"
  if [ -z "$measured" ]; then
    printf 'WARNING: check:dup could not measure %s: jscpd produced no figure for it.\n' "$shown" > "$report_dir/$number.warning"
  elif awk -v p="$measured" -v t="$threshold" 'BEGIN { exit !(p > t) }'; then
    printf 'WARNING: check:dup %s is over jscpd'\''s size limit (1000 lines or 100kb), so the blocking run skipped it; measured alone it is %s%% duplicated (threshold %s%%). Tracked debt: docs/harness/documented-exceptions.md\n' \
      "$shown" "$measured" "$threshold" > "$report_dir/$number.warning"
  fi
}

# Four measurements at a time: one jscpd start costs about half a second, and a whole-repo run
# has dozens of large files. The warnings print in file order afterwards, so the output does not
# depend on which measurement finishes first.
n=0
while IFS= read -r file; do
  n=$((n + 1))
  measure_one "$n" "$file" &
  [ $((n % 4)) -eq 0 ] && wait
done <<< "$skipped"
wait
for ((i = 1; i <= n; i++)); do
  [ -f "$report_dir/$i.warning" ] && cat "$report_dir/$i.warning" >&2
done
exit 0
